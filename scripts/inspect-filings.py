import importlib.util,json,zipfile,io,urllib.request,urllib.parse
from pathlib import Path
spec=importlib.util.spec_from_file_location('fd','scripts/fetch-dart.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.read_env('.env')
import os
key=os.environ['DART_API_KEY'];out=Path('var/filings');out.mkdir(parents=True,exist_ok=True)
import sys
receipts=sys.argv[1:]
if receipts==['--review']:
 d=json.loads(Path('var/dart/staged.json').read_text());receipts=sorted({r['rcept_no'] for r in d['records'] if r['issues']})
for receipt in (receipts or ['20250319000548','20250321001340','20260319001392']):
 if not __import__('re').fullmatch(r'\d{14}',receipt):raise ValueError('Invalid receipt')
 target=out/(receipt+'.zip')
 try:
  if not target.exists():
   url='https://opendart.fss.or.kr/api/document.xml?'+urllib.parse.urlencode({'crtfc_key':key,'rcept_no':receipt})
   with urllib.request.urlopen(url,timeout=90) as r:target.write_bytes(r.read())
  with zipfile.ZipFile(target) as z:
   for name in z.namelist():
    if name.lower().endswith('.xml'):
     raw=z.read(name)
     for enc in ['utf-8','euc-kr']:
      try:text=raw.decode(enc);break
      except UnicodeDecodeError:pass
     (out/(receipt+'-'+name.replace('/','_')+'.txt')).write_text(text)
  print('Saved filing',receipt,flush=True)
 except Exception as e:print('Failed filing',receipt,type(e).__name__,flush=True)
