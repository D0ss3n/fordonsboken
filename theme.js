(()=>{
  const key='fordonsmappen.theme';
  const url=new URL(location.href);
  const fromUrl=url.searchParams.get('theme');
  let savedTheme=null;
  try{savedTheme=localStorage.getItem(key)}catch{}

  // A legacy theme query parameter can reflect a previously shared choice,
  // so it must win over a stale value saved by another page or deployment.
  const theme=fromUrl==='dark'||fromUrl==='light'
    ? fromUrl
    : savedTheme==='dark'||savedTheme==='light' ? savedTheme : 'light';
  if((fromUrl==='dark'||fromUrl==='light')&&savedTheme!==fromUrl){
    try{localStorage.setItem(key,fromUrl)}catch{}
  }
  document.documentElement.dataset.theme=theme;


})();
