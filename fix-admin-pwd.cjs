const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

const old = `<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <input type="password" placeholder="New password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:160,padding:"7px 10px",fontSize:12}}/>
        <button onClick={changePassword} style={{...s.btnGold,fontSize:12,padding:"7px 14px"}}>Update Password</button>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?"#4ade80":"#e74c3c"}}>{pwdMsg.text}</span>}
        <button onClick={handleLogout} style={s.btnGhost}>Sign Out</button>
      </div>`;

const rep = `<div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",minWidth:0}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <input type={showPwd?"text":"password"} placeholder="New password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:140,padding:"7px 10px",fontSize:12}}/>
          <button onClick={()=>setShowPwd(p=>!p)} style={{...s.btnGhost,padding:"7px 10px",fontSize:11}}>{showPwd?"Hide":"Show"}</button>
          <button onClick={changePassword} style={{...s.btnGold,fontSize:12,padding:"7px 12px"}}>Update</button>
          <button onClick={handleLogout} style={{...s.btnGhost,padding:"7px 12px"}}>Sign Out</button>
        </div>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?"#4ade80":"#e74c3c"}}>{pwdMsg.text}</span>}
      </div>`;

c = c.replace(old, rep);
fs.writeFileSync('src/AdminDashboard.jsx', c);
console.log('Done:', c.includes('showPwd?"text"'));
