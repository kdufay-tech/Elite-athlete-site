export default function AICoachConsentModal({ onAgree, onCancel, saving }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:"1rem"}}>
      <div style={{background:"#0d0b08",border:"1px solid rgba(201,168,76,0.35)",borderRadius:"14px",maxWidth:"440px",width:"100%",padding:"1.75rem"}}>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.3rem",fontWeight:600,color:"var(--gold)",marginBottom:"0.75rem"}}>
          Before you start with Elite Coach
        </div>
        <div style={{fontSize:"0.9rem",color:"#D8D2C6",lineHeight:1.6,marginBottom:"1rem"}}>
          Elite Coach uses a third-party AI service — <strong>Anthropic (Claude)</strong> — to generate personalized coaching responses.
        </div>
        <div style={{fontSize:"0.86rem",color:"#B8B2A6",lineHeight:1.6,marginBottom:"1rem"}}>
          To do this, the app sends your training data to Anthropic, including: your check-ins (recovery, energy, sleep, soreness), workout logs and loads, nutrition logs, body metrics, and performance benchmarks. This data is used only to produce your coaching responses.
        </div>
        <div style={{fontSize:"0.8rem",color:"#8A8478",lineHeight:1.5,marginBottom:"1.5rem"}}>
          See our <a href="https://elite-athlete.app/privacy" target="_blank" rel="noopener noreferrer" style={{color:"var(--gold)"}}>Privacy Policy</a> for details. You can decline and continue using the rest of the app without Elite Coach.
        </div>
        <div style={{display:"flex",gap:"0.75rem",flexWrap:"wrap"}}>
          <button className="bg" style={{flex:1,minWidth:"140px",padding:"0.8rem",opacity:saving?0.6:1}} disabled={saving} onClick={onAgree}>
            {saving ? "Saving…" : "Agree & Continue"}
          </button>
          <button className="bgh" style={{flex:1,minWidth:"120px",padding:"0.8rem"}} disabled={saving} onClick={onCancel}>
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
