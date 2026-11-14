// Servidor de Google simulado para las pruebas: /auth (consentimiento), /token y /set (elige el email del siguiente login).
const http=require('http'), crypto=require('crypto');
const codes=new Map(); let nextEmail='ana@example.com'; let mode='ok';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://x');
 if(u.pathname==='/set'){nextEmail=u.searchParams.get('email');mode=u.searchParams.get('mode')||'ok';return res.end('ok');}
 if(u.pathname==='/auth'){
  const code=crypto.randomBytes(8).toString('hex');
  codes.set(code,{nonce:u.searchParams.get('nonce'),challenge:u.searchParams.get('code_challenge'),email:nextEmail,aud:u.searchParams.get('client_id')});
  const to=new URL(u.searchParams.get('redirect_uri'));
  to.searchParams.set('code',code); to.searchParams.set('state', mode==='badstate'?'x':u.searchParams.get('state'));
  res.writeHead(302,{location:to.toString()}); return res.end();
 }
 if(u.pathname==='/token'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const p=new URLSearchParams(body); const c=codes.get(p.get('code')); codes.delete(p.get('code'));
  const ok=c && crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url')===c.challenge && p.get('client_secret')==='test-secret';
  if(!ok){res.writeHead(400);return res.end('{"error":"invalid_grant"}');}
  const claims={iss:'https://accounts.google.com',aud:c.aud,sub:'1',email:c.email,email_verified:true,name:c.email.split('@')[0],picture:'',nonce:mode==='badnonce'?'zzz':c.nonce,exp:Math.floor(Date.now()/1000)+3600};
  res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({id_token:b64({alg:'none'})+'.'+b64(claims)+'.sig'}));
 });return;}
 res.writeHead(404);res.end();
}).listen(9999);
