> 최신 상태: 증권 1차 구현 이후 20개 업권으로 확장했습니다. 현재 분류 수와 적용 절차는 [20개 업권 확장 결과](INDUSTRIES-EXPANSION.md)를 먼저 확인하세요. 아래는 최초 구현 기록입니다.

# 업권 페이지 적용·검증·Render 배포 안내

이번에 작성한 코드와 SQL은 **아직 운영 DB와 Render에 적용하지 않았습니다**. 사용자가 요청한 사전 승인 조건에 따라 DB 변경과 실제 배포를 각각 승인받은 뒤 진행합니다. 비밀값은 대화·GitHub·이 문서에 붙여넣지 않습니다.

## 1. 먼저 로컬 화면 확인하기

프로젝트 폴더 `app`에서 실행합니다. 기존에 설치된 의존성을 그대로 사용할 수 있습니다.

```sh
npm start
```

브라우저에서 `http://localhost:3000/industries/securities`를 엽니다. 전체 안내는 `/industries`입니다. 새 테이블이 아직 없어도 로컬의 검토된 분류 파일과 기존 DB의 DART 연결 자료를 **읽기만** 해서 화면을 제공합니다. 서버 시작 시 DB 변경은 하지 않습니다.

정상 화면에서는 바로 상위 20건과 기업별 현황이 보입니다. 이름·회사·직위·연도를 바꿔 검색하고, 다음 페이지와 CSV를 확인합니다. 이름을 클릭하면 업권 안에서 그 이름을 검색하고, 보수표의 회사명을 클릭하면 기존 전체 기업 검색을 자동 실행합니다. 익명 이름은 인물로 추정하지 않습니다.

PC에서 표 전체가 보이는지, 휴대전화 너비에서 가로 스크롤로 보수와 연도를 끝까지 볼 수 있는지 확인하세요. 메뉴·입력·버튼·스크롤 영역의 키보드 포커스도 확인합니다. 현재 브라우저 시각 검증 결과는 제공하지 않으며 HTML·HTTP 테스트와 CSS 검토 결과를 보고합니다.

### DB가 연결되지 않을 때

이번 작업 중 초기 스키마 확인 후 `ENOTFOUND` 오류가 발생했습니다. 이는 호스트 이름을 IP로 찾지 못한 상태입니다. Aiven 서비스 상태와 `.env`의 DB_HOST가 서비스 화면의 Host와 같은지 확인합니다. Host에는 `https://`나 포트를 함께 넣지 않습니다. PORT는 별도 DB_PORT 항목입니다. 인증서 확인을 끄거나 TLS 없이 우회하지 않습니다.

DNS 연결이 복구되면 먼저 다음 읽기 전용 확인을 실행합니다.

```sh
node scripts/check-db.js
node scripts/migrate-industries.js
```

두 번째 명령은 기본 **dry-run**입니다. 테이블 생성이나 데이터 삽입을 하지 않고 예정 작업과 현재 건수만 보여줍니다. DB 없이 파일 기반 계획만 보려면 다음을 사용합니다.

```sh
node scripts/migrate-industries.js --plan-only
```

예정 결과는 신규 테이블 4개, 기본 업권 20개, 회사 후보 30개, 승인 분류 27개, 검토 대상 3개입니다. 금융의 부모 노드 FINANCE는 공개 20개 목록과 별도입니다.

## 2. 로컬 자동 테스트

```sh
npm test
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p 'test_*.py'
```

Node 테스트는 로컬 HTTP 포트를 사용합니다. 테스트용 모의 DB에서 업권 밖 회사 차단, 이름이 같아도 다른 DART 법인 분리, 회사명 변경 중복 방지, 검색 조건, 공동 순위·상위20건, 페이지 이동, CSV 수식 방어, 빈 페이지·SEO 및 기존 검색 회귀를 확인합니다. 실제 DB 마이그레이션을 대신하지 않습니다.

저장된 실제 OpenDART 수집본으로 검토한 증권 자료는 2024년 132건, 2025년 135건입니다. 이 건수는 공시 기준의 지급 내역이지 전체 임직원 수가 아닙니다. 2021~2023년 자료는 기존 검색에 유지하며 새 업권 집계에 회사명만으로 연결하지 않습니다.

## 3. DB 적용 계획 확인 및 승인

분석·설계·위험은 `INDUSTRIES-PLAN.md`, 실제 SQL은 `../migrations/001-industries.sql`에 있습니다. 적용할 내용은 다음 네 테이블의 생성 및 초기 자료 추가입니다.

1. 업권 정의: industry_categories
2. DART 기준 회사: industry_companies
3. 승인·검토 상태와 적용 기간: company_industries
4. 보수 행과 회사 식별 근거: salary_company_links

기존 salary_data와 salary_dart_sources는 삭제·초기화·ALTER하지 않습니다. 과거 회사 연결을 이름으로 일괄 생성하지 않습니다. 새 분류 테이블의 미검토 회사는 조회에서 제외합니다.

**이 계획에 대한 DB 변경 승인을 받은 뒤에만** 다음 명령을 실행합니다.

```sh
node scripts/migrate-industries.js --apply
```

도구는 먼저 기존 테이블을 일관된 스냅샷으로 읽어 `var/backups/before-industries-...json.gz`에 압축 백업하고, 체크섬을 출력합니다. 파일 권한은 소유자 전용입니다. 백업에는 개인별 공시 내역이 있으므로 Git에 추가하지 않습니다. 이후 신규 테이블을 만들고 초기 분류를 저장하며, 기존 두 테이블의 내용이 백업과 같은지 비교합니다.

MySQL에서 CREATE TABLE은 자동 커밋되므로 도중 실패하면 신규 테이블 일부가 남을 수 있습니다. 이때 자동으로 DROP하거나 기존 데이터를 지우지 않습니다. 백업 경로와 오류를 보관하고 부분 스키마를 검토합니다. 신규 테이블이 이미 존재하면 기본 적용은 중단합니다. 추가 기업 등 명시적으로 검토된 새 seed만 넣으려면 별도 검토 후 `--seed-only --apply`를 사용합니다. 기존 승인 상태·기간이 다르면 덮어쓰지 않고 충돌로 중단합니다.

## 4. 적용 후 확인

DB 적용 완료 뒤에는 다음을 확인합니다.

- 기존 연도별 salary_data 건수와 원본 내용이 유지됐는지
- 20개 공개 분류 정의와 부모 FINANCE, 회사별 고유번호 및 종목코드
- approved 기업만 증권 조회에 포함되는지, pending 3곳은 빠지는지
- 2024·2025 조회, 상위20건과 상세 결과의 건수
- 이름·직위·회사 조건을 동시에 적용해도 업권 밖 결과가 나오지 않는지
- 페이지 2 이후와 CSV가 전체 필터 결과를 포함하는지
- 기존 전체 검색·자동완성·연도·다운로드가 유지되는지

표시 회사 수와 공시 건수는 향후 수집에 따라 늘어날 수 있습니다. 이를 코드에 고정하지 않았습니다. 데이터 캐시는 15초 안에 갱신됩니다.

## 5. 새 기업·새 연도 자료 처리

승인된 기업의 새 연도가 salary_data 및 salary_dart_sources에 추가되면 페이지와 연도 선택에 자동 반영됩니다. 새로운 기업을 회사명으로 추정해서 분류하지 않습니다. 다음 도구는 DART 고유번호 기준으로 새로운 기업을 발견하고 분류 제안 파일을 만듭니다. **DB에 쓰지 않습니다.**

```sh
node scripts/prepare-industry-classifications.js
```

DB 연결 없이 기존 수집본을 이용할 수도 있습니다.

```sh
node scripts/prepare-industry-classifications.js --from-stage var/dart/staged.json
```

기업개황을 최대 20곳 더 조회하려면 다음과 같이 명시합니다. DART_API_KEY는 `.env`에서 읽습니다.

```sh
node scripts/prepare-industry-classifications.js --fetch-metadata --limit 20
```

확인된 기존 기업의 업종 변경이나 상호 변경을 재검토할 때는 다음처럼 새 기업개황을 가져옵니다.

```sh
node scripts/prepare-industry-classifications.js --refresh-known --fetch-metadata --limit 100
```

결과는 `var/industries/classification-proposals.json`입니다. 정확한 세부 업종코드가 일치해도 적용 기간은 null인 **제안**으로 남깁니다. 현재 코드 기준의 사업과 과거 사업이 같은지 확인한 뒤 기간을 정하고, 검토한 파일만 data/industry-companies.json에 반영합니다. 다른 업권·불명확한 기업은 미분류/검토 필요 상태로 유지합니다. 주력 업권 기간의 중복과 종목코드 충돌은 적용 전에 차단합니다.

현재 1차 개발에서는 증권만 제공합니다. 은행·금융지주 및 보험은 다음 단계이며, 나머지 업권도 같은 구조에 근거 자료를 추가하고 공개 여부를 켜는 방식으로 확장합니다. 업권 비교는 충분한 회사·연도 자료가 확보된 뒤 별도로 제공합니다.

## 6. 승인 후 Render 배포

현재 Render 계정 연결이 없어 실제 배포는 실행하지 않았습니다. DB 적용과 코드 검토가 끝나고 **배포 승인**을 받은 뒤 진행합니다.

1. GitHub에서 이번 변경 내용을 검토합니다. `.env`, 인증서, var/ 및 node_modules 변경을 새 커밋에 넣지 않습니다. 현재 로컬에는 이전 작업의 미커밋 변경도 함께 있으므로 전체 `git add .` 대신 변경 목록을 확인합니다.
2. 승인된 변경을 기존 서비스가 배포하는 브랜치로 병합합니다. 자동 배포가 켜져 있으면 병합 자체가 배포를 시작할 수 있으므로 먼저 Render 설정을 확인합니다.
3. Render의 기존 SALARY INSIGHT용 Web Service를 엽니다. 새 서비스나 DB를 임의로 만들지 않습니다.
4. 기존 Repository, Branch, Root Directory를 유지합니다. 로컬 폴더가 app인 것과 저장소 안의 경로는 다를 수 있습니다. 기존 저장소 루트에 server.js가 있으면 Root Directory를 app으로 바꾸지 않습니다.
5. 기존 환경변수 DB_HOST·DB_PORT·DB_USER·DB_PASSWORD·DB_NAME·DB_SSL_CA_BASE64를 확인합니다. 이번 분류 테이블이 있는 DB를 바라봐야 합니다. 화면에 보이는 비밀값을 캡처하거나 공유하지 않습니다.
6. Build Command는 기존 설정을 유지하되 통상 `npm ci`, Start Command는 `npm start` 또는 기존 `node server.js`입니다. PORT는 Render가 제공합니다. 마이그레이션을 시작 명령에 추가하지 않습니다.
7. Deploy Latest Commit을 실행하고 배포 로그가 성공으로 끝나는지 확인합니다.
8. 실제 도메인에서 `/`, `/industries`, `/industries/securities`, 연도·검색·CSV·기존 검색·모바일 표를 점검합니다. `/sitemap.xml`에 증권 업권 URL이 있고 검토 중 업권 URL은 없는지 확인합니다.

AdSense는 정보성 콘텐츠와 실제 자료를 제공하도록 개선했지만 승인 결과를 보장하지 않습니다. 광고 재도입은 별도 콘텐츠·정책 검토 후 결정합니다.

### 문제가 생기면

Render에서 이전 정상 배포로 되돌리면 기존 서비스 코드를 복구할 수 있습니다. 새 분류 테이블은 원본 보수 테이블과 분리돼 있으므로 자동 삭제하지 않고 보관합니다. 데이터가 변경된 것으로 의심되면 쓰기 작업을 멈추고 적용 전 백업과 대조합니다. 원본 테이블의 삭제·재생성으로 해결하지 않습니다.
