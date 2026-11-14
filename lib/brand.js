function siteHeader(section=''){
 const links=[['search','/','기업 검색'],['industries','/industries','업권별 정보'],['groups','/groups','기업그룹별 정보']];
 return `<header class="site-header"><a class="brand" href="/" aria-label="SALARY INSIGHT 기업 검색"><span class="brand-icon" aria-hidden="true">S</span><span><span class="brand-name">SALARY INSIGHT</span><span class="brand-subtitle">국내 기업 연봉정보 플랫폼</span></span></a><nav class="site-nav" aria-label="주요 메뉴">${links.map(([key,url,label])=>`<a href="${url}"${section===key?' aria-current="page"':''}>${label}</a>`).join('')}</nav></header>`;
}
module.exports={siteHeader};
