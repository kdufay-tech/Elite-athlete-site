const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

// Find and replace the entire header render
const oldHeader = c.substring(c.indexOf("return (\n    <div style={s.root}>\n      <div style={s.header}>"), c.indexOf("</div>\n      <div style={s.inner}>"));

const newHeader = `return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.eyebrow}>Elite Athlete</div>
          <div style={s.title}>Admin Dashboard</div>
        </div>
        <button onClick={fetchData} style={{...s.btnGold,fontSize:11,padding:"6px 12px"}}>↺ Refresh</button>
      </div>
      <div style={{background:'#111',padding:'12px 16px',borderBottom:'1px solid #C9A84C1a',display:'flex',flexDirection:'column',gap:8}}>
        <div style={{position:'relative'}}>
          <input type={showPwd?"text":"password"} placeholder="New admin password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:'100%',paddingRight:40,boxSizing:'border-box'}}/>
          <button onClick={()=>setShowPwd(p=>!p)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#888',fontSize:16,padding:0}}>
            {showPwd?'🙈':'👁'}
          </button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={changePassword} style={{...s.btnGold,flex:1,fontSize:13}}>Update Password</button>
          <button onClick={handleLogout} style={{...s.btnGhost,flex:1,fontSize:13}}>Sign Out</button>
        </div>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?'#4ade80':'#e74c3c'}}>{pwdMsg.text}</span>}
      </div>`;

c = c.replace(oldHeader, newHeader);
fs.writeFileSync('src/AdminDashboard.jsx', c);
console.log('Done:', c.includes('New admin password'));
