/**
 * The report's browser script: tabs with roving-tabindex keyboard support,
 * locale-aware durations and dates, and a print layout that opens every stage.
 * It runs in the viewer's browser, so it is plain script text and not a module.
 */
export const clientScript = (firstStageId: number): string => `(function(){
  "use strict";
  var active=${JSON.stringify(firstStageId)};
  var tabs=Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
  window.show=function(n){
    active=n;
    document.querySelectorAll('[role=tabpanel]').forEach(function(p){p.hidden=(p.id!=='stage-'+n);});
    tabs.forEach(function(t){var on=t.id==='tab-'+n;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});
  };
  // Roving-tabindex keyboard support on the tablist (WAI-ARIA Tabs pattern).
  var list=document.querySelector('[role=tablist]');
  if(list){list.addEventListener('keydown',function(e){
    var i=tabs.indexOf(document.activeElement);if(i<0)return;var j=i;
    if(e.key==='ArrowRight')j=(i+1)%tabs.length;
    else if(e.key==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;
    else if(e.key==='Home')j=0;else if(e.key==='End')j=tabs.length-1;else return;
    e.preventDefault();var id=+tabs[j].id.replace('tab-','');window.show(id);tabs[j].focus();
  });}
  // Locale-aware durations (Intl.DurationFormat) and dates (Intl.DateTimeFormat),
  // formatted in the viewer's browser; server text is the no-JS fallback.
  function fmt(){
    var DF=(window.Intl&&Intl.DurationFormat)?new Intl.DurationFormat(undefined,{style:'narrow'}):null;
    document.querySelectorAll('.dur[data-ms]').forEach(function(el){
      var ms=+el.getAttribute('data-ms');if(!ms)return;var s=Math.round(ms/1000);
      var d={hours:Math.floor(s/3600),minutes:Math.floor((s%3600)/60),seconds:s%60};
      if(DF){try{el.textContent=DF.format(d);return;}catch(_){}}
    });
    var DT=window.Intl?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}):null;
    document.querySelectorAll('.ts[data-iso]').forEach(function(el){
      var d=new Date(el.getAttribute('data-iso'));if(isNaN(+d))return;
      el.textContent=DT?DT.format(d):d.toLocaleString();el.setAttribute('title',d.toISOString());
    });
  }
  window.addEventListener('DOMContentLoaded',function(){window.show(active);fmt();});
  // Save-as-PDF: lay every stage out linearly and open all sections (a collapsed
  // <details> or a hidden panel won't print), then restore the interactive view.
  window.addEventListener('beforeprint',function(){
    document.querySelectorAll('[role=tabpanel]').forEach(function(p){p.hidden=false;});
    document.querySelectorAll('details').forEach(function(d){d.dataset.wo=d.open?'1':'0';d.open=true;});
  });
  window.addEventListener('afterprint',function(){
    document.querySelectorAll('details').forEach(function(d){d.open=d.dataset.wo==='1';});
    window.show(active);
  });
})();`;
