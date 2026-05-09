const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

const old = `        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={fetchData} style={s.btnGold}>↺ Refresh</button>
          <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",minWidth:0}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <input type={showPwd?"text":"password"} placeholder="New password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:140,padding:"7px 10px",fontSize:12}}/>
          <button onClick={()=>setShowPwd(p=>!p)} style={{...s.btnGhost,padding:"7px 10px",fontSize:11}}>{showPwd?"Hide":"Show"}</button>
          <button onClick={changePassword} style={{...s.btnGold,fontSize:12,padding:"7px 12px"}}>Update</button>
          <button onClick={handleLogout} style={{...s.btnGhost,padding:"7px 12px"}}>Sign Out</button>
        </div>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?"#4ade80":"#e74c3c"}}>{pwdMsg.text}</span>}
      </div>
        </div>
      </div>`;

const rep = `        <button onClick={fetchData} style={{...s.btnGold,padding:"6px 12px",fontSize:12}}>↺</button>
      </div>
      <div style={{background:'#111',borderBottom:'1px solid #C9A84C1a',padding:'0 16px 14px',display:'flex',flexDirection:'column',gap:8}}>
        <div style={{position:'relative'}}>
          <input type={showPwd?"text":"password"} placeholder="New admin password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:'100%',paddingRight:38,boxSizing:'border-box'}}/>
          <button onClick={()=>setShowPwd(p=>!p)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#888',fontSize:18,padding:0,lineHeight:1}}>
            {showPwd?'🙈':'👁'}
          </button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={changePassword} style={{...s.btnGold,flex:1,fontSize:13,padding:'8px'}}>Update Password</button>
          <button onClick={handleLogout} style={{...s.btnGhost,flex:1,fontSize:13,padding:'8px'}}>Sign Out</button>
        </div>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?'#4ade80':'#e74c3c'}}>{pwdMsg.text}</span>}
      </div>`;

c = c.replace(old, rep);
fs.writeFileSync('src/AdminDashboard.jsx', c);
console.log('Done:', c.includes('New admin password'));
