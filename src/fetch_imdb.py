import csv,json,os,sys,time
from copy import deepcopy
from datetime import datetime,timezone
from pathlib import Path
from typing import Any
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parent;DOCS=ROOT.parent/'docs';CSV_PATH=ROOT/'ratings.csv';OUTPUT=DOCS/'movies.json';TIMEOUT=12;MAX_PER_KEY=1000;SLEEP=.12
s=requests.Session();s.headers.update({'User-Agent':'IMDb-Showcase/2.0 (+https://github.com/mehrdadmb2/imdb-showcase)'})
def now():return datetime.now(timezone.utc).isoformat()
def text(v:Any):
    if v is None:return ''
    x=str(v).strip();return '' if not x or x.upper()=='N/A' else x
def number(v,default=0):
    try:return float(str(v).replace(',','').strip())
    except:return default
def old_data():
    if not OUTPUT.exists():return {'movies':[],'data_meta':{}}
    try:return json.loads(OUTPUT.read_text(encoding='utf-8'))
    except Exception as e:print('WARN old dataset:',e);return {'movies':[]}
def read_csv():
    if not CSV_PATH.exists():raise FileNotFoundError(f'{CSV_PATH} not found')
    with CSV_PATH.open('r',encoding='utf-8-sig',newline='') as f:
        r=csv.DictReader(f);fields=set(r.fieldnames or []);req={'Const','Title','Your Rating','Date Rated'}
        if not req.issubset(fields):raise ValueError(f'Missing CSV fields: {sorted(req-fields)}')
        out=[]
        for row in r:
            iid=text(row.get('Const'))
            if not iid:continue
            out.append({'imdb_id':iid,'title':text(row.get('Title')) or 'Untitled','original_title':text(row.get('Original Title')) or text(row.get('Title')),'year':text(row.get('Year')),'user_rating':number(row.get('Your Rating')),'date_rated':text(row.get('Date Rated')),'title_type':text(row.get('Title Type')) or 'Other','imdb_rating':text(row.get('IMDb Rating')),'runtime':text(row.get('Runtime (mins)')),'genres':text(row.get('Genres')),'num_votes':text(row.get('Num Votes')),'release_date':text(row.get('Release Date')),'directors':text(row.get('Directors')),'url':text(row.get('URL'))})
    if not out:raise ValueError('CSV contains no records')
    return out
def keys():
    raw=os.getenv('OMDB_API_KEYS','').strip() or os.getenv('OMDB_API_KEY','').strip()
    k=[x.strip() for x in raw.split(',') if x.strip()]
    if not k:raise RuntimeError('OMDB_API_KEY or OMDB_API_KEYS is missing')
    return k
class Pool:
    def __init__(self,k):self.k=k;self.i=0;self.usage={x:0 for x in k}
    def next(self):
        for _ in self.k:
            x=self.k[self.i];self.i=(self.i+1)%len(self.k)
            if self.usage[x]<MAX_PER_KEY:return x
        return None
def omdb(iid,pool):
    key=pool.next()
    if not key:return None,'key-limit'
    try:
        r=s.get('https://www.omdbapi.com/',params={'i':iid,'apikey':key,'plot':'full'},timeout=TIMEOUT);pool.usage[key]+=1
        if r.status_code!=200:return None,f'http-{r.status_code}'
        d=r.json();return (d,'ok') if d.get('Response')=='True' else (None,d.get('Error','omdb-failed'))
    except requests.RequestException as e:pool.usage[key]+=1;return None,str(e)
def poster(iid):
    try:
        r=s.get(f'https://www.imdb.com/title/{iid}/',timeout=TIMEOUT)
        if r.status_code!=200:return ''
        tag=BeautifulSoup(r.text,'html.parser').find('meta',property='og:image')
        return text(tag.get('content')) if tag else ''
    except requests.RequestException:return ''
def merge(base,new):
    x=deepcopy(base)
    for k,v in new.items():
        if v not in ('',None,[],{}):x[k]=v
    return x
def series_fields(d,row):
    ep=row.get('title_type')=='TV Episode' or bool(d.get('Episode'))
    return {'series_id':text(d.get('seriesID')),'series_title':text(d.get('series')),'season_number':int(number(d.get('Season'),0)),'episode_number':int(number(d.get('Episode'),0)),'episode_title':text(d.get('Title')) or row.get('title',''),'total_seasons':int(number(d.get('totalSeasons'),0)),'total_episodes':0,'is_episode':ep}
def build(row,old,d,status):
    x=deepcopy(old) if old else {};x.update(row)
    if d:
        x=merge(x,{'poster':text(d.get('Poster')),'plot':text(d.get('Plot')),'rated':text(d.get('Rated')),'actors':text(d.get('Actors')),'writer':text(d.get('Writer')),'country':text(d.get('Country')),'language':text(d.get('Language')),'awards':text(d.get('Awards')),'box_office':text(d.get('BoxOffice')),'production':text(d.get('Production')),'website':text(d.get('Website')),'metascore':text(d.get('Metascore')),'ratings':d.get('Ratings') if isinstance(d.get('Ratings'),list) else [],'data_fetched_at':now()})
        for a,b in {'imdb_rating':'imdbRating','num_votes':'imdbVotes','runtime':'Runtime','directors':'Director','genres':'Genre','release_date':'Released'}.items():
            if not text(x.get(a)):x[a]=text(d.get(b))
        x.update(series_fields(d,row));x.update({'omdb_found':True,'data_status':'fresh','data_stale_reason':'','fields_fresh':['omdb','poster','plot','ratings','series']});return x,False
    if old:
        if not text(x.get('poster')):
            p=poster(row['imdb_id'])
            if p:x['poster']=p
        x.update({'omdb_found':False,'data_status':'stale','data_stale_reason':status,'fields_fresh':['csv'],'data_fetched_at':text(old.get('data_fetched_at'))});return x,True
    p=poster(row['imdb_id']);x['poster']=p if p else x.get('poster','');x.update({'plot':'N/A','rated':'N/A','actors':'N/A','writer':'N/A','country':'N/A','language':'N/A','awards':'N/A','box_office':'N/A','production':'N/A','metascore':'N/A','ratings':[],'is_episode':row.get('title_type')=='TV Episode','data_status':'partial','data_stale_reason':status,'data_fetched_at':'','fields_fresh':['csv'],'omdb_found':False});return x,True
def totals(records):
    t={}
    for x in records:
        k=x.get('series_id') or x.get('series_title')
        if k and x.get('is_episode'):t[k]=t.get(k,0)+1
    for x in records:
        k=x.get('series_id') or x.get('series_title')
        if k:x['total_episodes']=t.get(k,0)
    return records
def write(payload):
    DOCS.mkdir(parents=True,exist_ok=True);tmp=OUTPUT.with_suffix('.json.tmp');tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');tmp.replace(OUTPUT)
def main():
    old=old_data();idx={x.get('imdb_id'):x for x in old.get('movies',[]) if x.get('imdb_id')};rows=read_csv();pool=Pool(keys());out=[];fresh=stale=partial=0;errors=[]
    for n,row in enumerate(rows,1):
        print(f'[{n}/{len(rows)}] {row["title"]}',flush=True);d,status=omdb(row['imdb_id'],pool);x,was_stale=build(row,idx.get(row['imdb_id']),d,status);out.append(x);fresh+=1 if d else 0;stale+=1 if (not d and row['imdb_id'] in idx) else 0;partial+=1 if (not d and row['imdb_id'] not in idx) else 0
        if not d:errors.append({'imdb_id':row['imdb_id'],'title':row['title'],'reason':status})
        time.sleep(SLEEP)
    out=totals(out);t=now();write({'schema_version':2,'last_manual_update':t,'data_meta':{'generated_at':t,'source_csv_records':len(rows),'updated_records':len(out),'omdb_success':fresh,'omdb_stale':stale,'omdb_partial':partial,'api_errors':len(errors),'key_count':len(pool.k),'key_usage_total':sum(pool.usage.values()),'previous_data_available':bool(idx),'failure_policy':'keep_previous_enriched_fields_on_partial_failure'},'movies':out,'errors':errors[:100]});print(f'OK fresh={fresh} stale={stale} partial={partial} errors={len(errors)}')
if __name__=='__main__':
    try:main()
    except Exception as e:print('Update aborted; previous movies.json left untouched:',e);sys.exit(1)
