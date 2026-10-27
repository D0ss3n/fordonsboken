(()=>{
  const key='fordonsmappen.theme';
  const url=new URL(location.href);
  const fromUrl=url.searchParams.get('theme');
  let savedTheme=null;
  try{savedTheme=localStorage.getItem(key)}catch{}

  // A theme carried by an internal link reflects the choice at click time,
  // so it must win over a stale value saved by another page or deployment.
  const theme=fromUrl==='dark'||fromUrl==='light'
    ? fromUrl
    : savedTheme==='dark'||savedTheme==='light' ? savedTheme : 'light';
  if((fromUrl==='dark'||fromUrl==='light')&&savedTheme!==fromUrl){
    try{localStorage.setItem(key,fromUrl)}catch{}
  }
  document.documentElement.dataset.theme=theme;

  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if(!link)return;
    try{
      const target=new URL(link.href,location.href);
      const isInternalFile=target.protocol==='file:';
      const isSameOrigin=target.origin===location.origin&&target.origin!=='null';
      if(isInternalFile||isSameOrigin){
        const current=document.documentElement.dataset.theme==='dark'?'dark':'light';
        target.searchParams.set('theme',current);
        link.href=target.href;
      }
    }catch{}
  },true);
})();
