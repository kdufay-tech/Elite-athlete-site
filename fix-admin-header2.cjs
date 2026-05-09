const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

const old = `<div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{display:"flex",flexDirection:"column",gap:8,width:"100%"}}>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={fetchData} style={{...s.btnGold,fontSize:11,padding:"6px 10px"}}>↺</button>
            <input type={showPwd?"text":"password"} placeholder="New password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,flex:1,padding:"7px 10px",fontSize:12}}/>
            <button onClick={()=>setShowPwd(p=>!p)} style={{...s.btnGhost,padding:"6px 8px",fontSize:11}}>{showPwd?"Hide":"Show"}</button>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={changePassword} style={{...s.btnGold,fontSize:12,padding:"7px 14px",flex:1}}>Update Password</button>
            <button onClick={handleLogout} style={{...s.btnGhost,padding:"7px 14px",flex:1}}>Sign Out</button>
          </div>
          {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?"#4ade80":"#e74c3c"}}>{pwdMsg.text}</span>}
        </div>
        </div>`;

const rep = `<div style={{display:"flex",flexDirection:"column",gap:6,flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={fetchData} style={{...s.btnGold,fontSize:11,padding:"6px 10px",flexShrink:0}}>↺</button>
            <div style={{position:"relative",flex:1}}>
              <input type={showPwd?"text":"password"} placeholder="New password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:"100%",padding:"7px 32px 7px 10px",fontSize:12,boxSizing:"border-box"}}/>
              <button onClick={()=>setShowPwd(p=>!p)} style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#888",padding:0,fontSize:14}}>
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={changePassword} style={{...s.btnGold,fontSize:12,padding:"7px 10px",flex:1}}>Update</button>
            <button onClick={handleLogout} style={{...s.btnGhost,padding:"7px 10px",flex:1}}>Sign Out</button>
          </div>
          {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?"#4ade80":"#e74c3c"}}>{pwdMsg.text}</span>}
        </div>`;

c = c.replace(old, rep);
fs.writeFileSync('src/AdminDashboard.jsx', c);
console.log('Done:', c.includes('boxSizing:"border-box"'));
