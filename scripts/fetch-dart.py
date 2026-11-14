#!/usr/bin/env python3
"""Fetch annual individual compensation. No database writes. Raw responses stay local."""
import argparse, datetime, decimal, hashlib, io, json, os, re, time, unicodedata, urllib.request, zipfile
from pathlib import Path
from xml.etree import ElementTree

def clean(value):
    text = unicodedata.normalize('NFKC', str(value or ''))
    text = text.replace('\\r\\n', ' ').replace('\\n',' ').replace('\u200b','').replace('\ufeff','')
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\(\s*주\s*\d+\s*\)|\[\s*주\s*\d+\s*\]|주\s*\d+\)', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def normalize(row, year, unit, company, stock_code=''):
    name = clean(row.get('nm'))
    if re.fullmatch(r'[가-힣]{2,6}[*†‡]',name):name=name[:-1]
    name=re.sub(r'[†‡]+$','',name).strip()
    position = re.sub(r'[*†‡]+$', '', clean(row.get('ofcps'))).strip()
    expansions={'CEO':'Chief Executive Officer','CFO':'Chief Financial Officer','COO':'Chief Operating Officer','CCO':'Chief Commerce Officer','CEHSO':'Chief Environment, Health, Safety Officer'}
    for acronym,expansion in expansions.items():
        position=re.sub(re.escape(acronym)+r'\s*\(\s*'+re.escape(expansion).replace(r'\ ',r'\s*')+r'\s*\)',acronym,position,flags=re.I)
    for a,b in [('대표 이사','대표이사'),('사내 이사','사내이사'),('사외 이사','사외이사')]:position=position.replace(a,b)
    raw = str(row.get('mendng_totamt', '')).strip()
    issues = []
    if stock_code.startswith(('900','950')):issues.append('foreign_issuer_currency_review')
    if not name or name in ('-', '합계', '계', '해당사항 없음'): issues.append('missing_or_aggregate_name')
    if not position or position == '-': issues.append('missing_position')
    if str(row.get('currency', 'KRW')).upper() not in ('KRW', '원'): issues.append('foreign_currency_requires_review')
    amount = None
    try:
        text = raw.replace(' ', '')
        if not re.fullmatch(r'(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?', text): raise ValueError()
        text = text.replace(',', '')
        value = decimal.Decimal(text) * {'원':1,'천원':1000,'백만원':1000000}[unit]
        if value != value.to_integral_value(): raise ValueError()
        amount = int(value)
        if amount < 500000000 or amount > 100000000000: issues.append('amount_requires_source_review')
    except (ValueError, decimal.InvalidOperation, KeyError): issues.append('invalid_amount_or_unit')
    receipt = str(row.get('rcept_no',''))
    if not re.fullmatch(r'\d{14}',receipt): issues.append('invalid_receipt')
    if row.get('stlm_dt') and not str(row['stlm_dt']).startswith(str(year)): issues.append('settlement_year_mismatch')
    return dict(company_name=company, fiscal_year=year, employee_name=name, position_name=position,
        compensation=str(amount) if amount is not None else None, corp_code=row.get('corp_code'), rcept_no=receipt,
        source_unit=unit, stock_code=stock_code, raw=row, issues=issues,
        changes={k:{'from':row.get(k),'to':v} for k,v in [('nm',name),('ofcps',position)] if str(row.get(k) or '')!=v})

def is_no_disclosure(row):
    # OpenDART can return status 000 with dash-only placeholder rows.
    missing={'','-','--','해당사항 없음','해당사항없음','해당 없음','없음'}
    return all(clean(row.get(field)) in missing for field in ('nm','ofcps')) and clean(row.get('mendng_totamt')) in missing|{'0','0.0'}

def read_env(filename):
    if not filename: return
    for line in Path(filename).read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        key,value=line.split('=',1)
        os.environ.setdefault(key.strip(),value.strip().strip('\"\''))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--workers',type=int,default=4,choices=range(1,9))
    parser.add_argument('--env');parser.add_argument('--years', nargs='+',type=int,default=[2024,2025])
    parser.add_argument('--unit',choices=['원','천원','백만원'],required=True,help='Confirm API source unit from source filings; never infer from magnitude')
    parser.add_argument('--corrections',help='Reviewed corrections JSON keyed by corp/year/receipt/raw name')
    parser.add_argument('--units',help='JSON corp_code/year -> source unit, for verified exceptions')
    parser.add_argument('--legacy-sql',help='Include unlisted companies matching legacy company names')
    parser.add_argument('--corp-codes',nargs='*',help='Optional bounded pilot scope')
    parser.add_argument('--out',default='var/dart');args=parser.parse_args();read_env(args.env)
    key=os.environ.get('DART_API_KEY') or os.environ.get('OPENDART_API_KEY')
    if not key: parser.error('DART_API_KEY is required; no requests sent')
    if any(y not in [2024,2025] for y in args.years): parser.error('Only 2024 and 2025 are supported by this update')
    out=Path(args.out);rawdir=out/'raw';rawdir.mkdir(parents=True,exist_ok=True)
    def request(endpoint, params):
        from urllib.parse import urlencode
        url='https://opendart.fss.or.kr/api/'+endpoint+'?'+urlencode(dict(crtfc_key=key,**params))
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url,timeout=45) as r: return r.read()
            except Exception:
                if attempt==3: raise RuntimeError('OpenDART transport failed (URL and key redacted)') from None
                time.sleep(2**attempt)
    registry=out/'corpCode.zip'
    if not registry.exists(): registry.write_bytes(request('corpCode.xml',{}))
    with zipfile.ZipFile(registry) as z: root=ElementTree.fromstring(z.read('CORPCODE.xml'))
    norm=lambda v:re.sub(r'\s+|주식회사|\(주\)','',unicodedata.normalize('NFKC',v)).casefold()
    legacy={}
    if args.legacy_sql:
        sql=Path(args.legacy_sql).read_text()
        for n in re.findall(r"^\(\d+,'((?:\\.|[^'\\])*)',\d+,",sql,re.M):legacy.setdefault(norm(n),n)
    companies=[];stock_codes={}
    for e in root.findall('list'):
        code=e.findtext('corp_code');name=e.findtext('corp_name') or '';stock=(e.findtext('stock_code') or '').strip()
        if args.corp_codes:
            selected=code in args.corp_codes
        else:selected=bool(stock) or norm(name) in legacy
        if selected:
            companies.append((code,legacy.get(norm(name),name)));stock_codes[code]=stock
    if not companies:raise RuntimeError('No companies selected')
    units=json.loads(Path(args.units).read_text()) if args.units else {}
    corrections=json.loads(Path(args.corrections).read_text()) if args.corrections else {}
    used_corrections=set()
    # Bounded parallel network I/O; cache remains one file per company/year.
    from concurrent.futures import ThreadPoolExecutor
    import threading
    halt=threading.Event();rate_lock=threading.Lock();last_request=[0.0];prefetch_errors={}
    tasks=[(code,year) for code,_ in companies for year in args.years if not (rawdir/f'{code}-{year}.json').exists()]
    def prefetch(task):
        code,year=task
        if halt.is_set():return task,'acquisition halted'
        with rate_lock:
            wait=.12-(time.monotonic()-last_request[0])
            if wait>0:time.sleep(wait)
            last_request[0]=time.monotonic()
        if halt.is_set():return task,'acquisition halted'
        try:
            payload=json.loads(request('indvdlByPay.json',{'corp_code':code,'bsns_year':year,'reprt_code':'11011'}))
            status=payload.get('status')
            if status not in ['000','013']:
                if status in ['010','011','012','020']:halt.set()
                return task,'OpenDART status '+str(status)
            target=rawdir/f'{code}-{year}.json'
            temporary=target.with_suffix('.tmp')
            temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2));temporary.replace(target)
            return task,None
        except Exception as e:return task,str(e)
    if tasks:
        print(f'Fetching {len(tasks)} uncached company-years with {args.workers} workers',flush=True)
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for index,(task,error) in enumerate(executor.map(prefetch,tasks),1):
                if error:prefetch_errors[task]=error
                if index%200==0:print(f'Prefetched {index}/{len(tasks)} company-years',flush=True)
    records=[];coverage=[];failures=[]
    for code,name in companies:
        for year in args.years:
            target=rawdir/f'{code}-{year}.json'
            try:
                if (code,year) in prefetch_errors:raise RuntimeError(prefetch_errors[(code,year)])
                if target.exists():payload=json.loads(target.read_text())
                else:
                    payload=json.loads(request('indvdlByPay.json',{'corp_code':code,'bsns_year':year,'reprt_code':'11011'}))
                    if payload.get('status') in ['000','013']:target.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
                    time.sleep(.25)
                status=payload.get('status')
                if status not in ['000','013']:raise RuntimeError('OpenDART status '+str(status))
                unit=units.get(f'{code}/{year}',args.unit)
                source_rows=payload.get('list',[])
                undisclosed=sum(is_no_disclosure(r) for r in source_rows)
                items=[normalize(dict(r,corp_code=code),year,unit,name,stock_codes.get(code,'')) for r in source_rows if not is_no_disclosure(r)]
                for item in items:
                    correction_key=f"{code}/{year}/{item['rcept_no']}/{item['raw'].get('nm','')}"
                    correction=corrections.get(correction_key)
                    if correction:
                        used_corrections.add(correction_key)
                        evidence=correction.get('evidence_url','')
                        if not correction.get('reason') or evidence!=f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={item['rcept_no']}":
                            raise RuntimeError('Correction requires a reason and matching DART filing URL')
                        for field in ('employee_name','position_name','compensation'):
                            if field not in correction: continue
                            before=item[field];value=str(correction[field])
                            if field=='compensation':
                                if not re.fullmatch(r'\d+',value) or not 500000000<=int(value)<=100000000000:
                                    raise RuntimeError('Correction amount must be a verified integer won value within the review bounds')
                            elif not clean(value): raise RuntimeError('Empty correction')
                            item[field]=value
                            item['changes'][field]=dict(before=before,after=value,reason=correction['reason'],evidence_url=evidence)
                        if correction.get('verification'):item['changes']['source_verification']=correction['verification']
                        # Revalidate corrected fields; independent provenance issues remain unresolved.
                        resolved=[]
                        if item['employee_name'] not in ('','-','합계','계','해당사항 없음'):resolved.append('missing_or_aggregate_name')
                        if item['position_name'] not in ('','-'):resolved.append('missing_position')
                        if 'compensation' in correction:resolved.extend(['amount_requires_source_review','invalid_amount_or_unit'])
                        if correction.get('currency')=='KRW' and 'compensation' in correction:resolved.append('foreign_issuer_currency_review')
                        item['issues']=[issue for issue in item['issues'] if issue not in resolved]
                records.extend(items);coverage.append(dict(corp_code=code,company_name=name,year=year,status=status,rows=len(items),undisclosed_rows=undisclosed))
            except Exception as e:
                failures.append(dict(corp_code=code,year=year,error=str(e)))
                print(f'Failed {code}/{year}: {e}',flush=True)
                if 'status 0' in str(e) and any(x in str(e) for x in ['010','011','012','020']):break
        if failures and any(x in failures[-1]['error'] for x in ['status 010','status 011','status 012','status 020']):break
        if len(coverage)%100==0:print(f'Fetched {len(coverage)} company-years',flush=True)
    # Exact duplicate source rows collapse; conflicting values remain visible for review.
    unique={}
    for r in records:
        ident=tuple(r.get(k) for k in ['corp_code','fiscal_year','employee_name','position_name','compensation'])
        unique.setdefault(ident,r)
    records=list(unique.values());identities={}
    for r in records:identities.setdefault((r['corp_code'],r['fiscal_year'],r['employee_name']),[]).append(r)
    for group in identities.values():
        if len(group)>1 and not re.search(r'[○●〇*]|[OX]{2,}',group[0]['employee_name']):
            for r in group:r['issues'].append('multiple_records_for_same_name_review')
    if set(corrections)-used_corrections:
        failures.append(dict(error='Unused corrections: verify corp/year/receipt/raw name keys'))
    report=dict(version=1,generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),years=args.years,
        scope='explicit pilot' if args.corp_codes else 'listed plus matching legacy companies',expected_company_years=len(companies)*len(args.years),
        complete=not failures and len(coverage)==len(companies)*len(args.years),coverage=coverage,failures=failures,records=records)
    encoded=json.dumps(report,ensure_ascii=False,indent=2)+'\n';(out/'staged.json').write_text(encoded)
    (out/'staged.sha256').write_text(hashlib.sha256(encoded.encode()).hexdigest()+'\n')
    (out/'review.json').write_text(json.dumps([r for r in records if r['issues']],ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(complete=report['complete'],company_years=len(coverage),records=len(records),review_required=sum(bool(r['issues']) for r in records),failures=len(failures))))
    if failures:raise SystemExit(1)
if __name__=='__main__':main()
