// One conversational home. Full cloud controls remain at /index.html?controls=1.
(()=>{const p=location.pathname;
 const controls=p==='/index.html'&&new URLSearchParams(location.search).get('controls')==='1';
 if((p==='/'||p==='/index.html')&&!controls){location.replace('/council-room.html');return;}
 if(p!=='/'&&p!=='/index.html'&&!/^\/(?:api|mcp|__hatchable)\//.test(p))location.replace('/council-room.html');
})();
