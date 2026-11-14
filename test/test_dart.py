import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('fetch_dart',Path(__file__).resolve().parents[1]/'scripts/fetch-dart.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Normalization(unittest.TestCase):
 def row(self,amount='900,000,001'):
  return dict(nm=' 홍길동\n',ofcps='前 대표이사\r\n(주1)',mendng_totamt=amount,rcept_no='20260316000001',corp_code='00126380',stlm_dt='2025-12-31')
 def test_won_no_extra_multiplier(self):
  r=m.normalize(self.row(),2025,'원','회사');self.assertEqual(r['compensation'],'900000001');self.assertEqual(r['issues'],[]);self.assertEqual(r['position_name'],'前 대표이사');self.assertIn('ofcps',r['changes'])
 def test_verified_million_unit(self):self.assertEqual(m.normalize(self.row('900.5'),2025,'백만원','회사')['compensation'],'900500000')
 def test_ambiguous_amount_flagged(self):self.assertIn('amount_requires_source_review',m.normalize(self.row('900'),2025,'원','회사')['issues'])
 def test_invalid_amount_never_zero(self):
  for a in ['-','USD 5,000','1억원','NaN','1,000천원','9,99,9']:
   r=m.normalize(self.row(a),2025,'원','회사');self.assertIsNone(r['compensation']);self.assertIn('invalid_amount_or_unit',r['issues'])
 def test_dash_only_placeholder_is_not_an_employee(self):
  self.assertTrue(m.is_no_disclosure(dict(nm='-',ofcps='-',mendng_totamt='-')))
  self.assertFalse(m.is_no_disclosure(dict(nm='홍길동',ofcps='-',mendng_totamt='-')))
 def test_foreign_issuer_and_footnote_names(self):
  r=self.row();r['nm']='김준형*';self.assertEqual(m.normalize(r,2025,'원','회사')['employee_name'],'김준형')
  r['nm']='*';self.assertEqual(m.normalize(r,2025,'원','회사')['employee_name'],'*')
  self.assertIn('foreign_issuer_currency_review',m.normalize(r,2025,'원','회사','950220')['issues'])
 def test_year_and_identity(self):
  r=self.row();r['nm']='합계';r['stlm_dt']='2024-12-31';x=m.normalize(r,2025,'원','회사');self.assertIn('missing_or_aggregate_name',x['issues']);self.assertIn('settlement_year_mismatch',x['issues'])
if __name__=='__main__':unittest.main()

class StagingWorkflow(unittest.TestCase):
 def test_cached_acquisition_correction_and_idempotent_package_validation(self):
  import tempfile,zipfile,json,os,sys,contextlib,io,subprocess
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as folder:
   folder=Path(folder);(folder/'raw').mkdir()
   with zipfile.ZipFile(folder/'corpCode.zip','w') as z:z.writestr('CORPCODE.xml','<result><list><corp_code>00126380</corp_code><corp_name>회사</corp_name><stock_code>005930</stock_code></list></result>')
   payload=dict(status='000',list=[dict(nm='홍길동',ofcps='대표 이사 (주1)',mendng_totamt='900,000,000',rcept_no='20260316000001',stlm_dt='2025-12-31')])
   (folder/'raw/00126380-2025.json').write_text(json.dumps(payload))
   correction={'00126380/2025/20260316000001/홍길동':dict(position_name='대표이사',reason='공시 원문 직위와 대조',evidence_url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260316000001')}
   (folder/'corrections.json').write_text(json.dumps(correction))
   argv=['fetch-dart.py','--unit','원','--years','2025','--corp-codes','00126380','--out',str(folder),'--corrections',str(folder/'corrections.json')]
   with patch.object(sys,'argv',argv),patch.dict(os.environ,{'DART_API_KEY':'test-only-not-sent'}),patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('Network must not be used')),contextlib.redirect_stdout(io.StringIO()):m.main()
   stage=json.loads((folder/'staged.json').read_text());self.assertTrue(stage['complete']);self.assertEqual(stage['records'][0]['position_name'],'대표이사');self.assertEqual(stage['records'][0]['raw']['ofcps'],'대표 이사 (주1)');self.assertIn('reason',stage['records'][0]['changes']['position_name'])
   app=Path(__file__).resolve().parents[1]
   result=subprocess.run(['node','scripts/apply-dart.js',str(folder/'staged.json')],cwd=app,capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);self.assertIn('"dryRun":true',result.stdout);self.assertIn('"accepted":1',result.stdout)
   (folder/'staged.json').write_text('{}')
   result=subprocess.run(['node','scripts/apply-dart.js',str(folder/'staged.json')],cwd=app,capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertIn('checksum mismatch',result.stderr)
