/** 内联到 layout，避免首屏闪烁 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('adminTheme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else document.documentElement.removeAttribute('data-theme');}catch(e){}})();`;
