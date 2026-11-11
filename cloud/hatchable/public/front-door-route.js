// Hatchable serves index.html for unknown paths (e.g. /login, /signin) with
// HTTP 200. Send those to the Council Room, the single front door, instead of
// showing Cloud controls under a wrong URL. "/" and "/index.html" stay as-is.
(()=>{const p=location.pathname;
 if(p!=='/'&&p!=='/index.html'&&!/^\/(?:api|mcp|__hatchable)\//.test(p))location.replace('/council-room.html');
})();
