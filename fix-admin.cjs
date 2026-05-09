const fs = require('fs');
let content = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

// Replace wrong account block with login form
const oldBlock = `if (user.email !== ADMIN_EMAIL) {
    return (`;

const newBlock = `if (user.email !== ADMIN_EMAIL) {
    return (
      <div style={s.root}>
        <div style={s.loginWrap}>
          <div style={s.loginBox}>
            <div style={s.eyebrow}>Elite Athlete</div>
            <div style={s.title}>Admin Access</div>
            <form onSubmit={handleLogin} style={{ marginTop: 28 }}>
              <input type="email" placeholder="Admin Email" value={email} required onChange={e => setEmail(e.target.value)} style={s.input}/>
              <input type="password" placeholder="Password" value={password} required onChange={e => setPassword(e.target.value)} style={{ ...s.input, marginTop: 12 }}/>
              {loginErr && <div style={s.loginErr}>{loginErr}</div>}
              <button type="submit" disabled={loginBusy} style={s.btnSubmit}>{loginBusy ? 'Signing in...' : 'Sign In as Admin'}</button>
            </form>
          </div>
        </div>
      </div>
    );
  }
  if (false) return (`;

content = content.replace(oldBlock, newBlock);
fs.writeFileSync('src/AdminDashboard.jsx', content);
console.log('Done');
