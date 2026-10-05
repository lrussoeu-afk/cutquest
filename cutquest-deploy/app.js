(() => {
  const cfg = window.CUTQUEST_CONFIG;
  const root = document.querySelector("#root");
  if (!cfg || !window.supabase) {
    root.innerHTML = `<main class="auth-wrap"><div class="auth-card"><h2>CutQuest could not start</h2><p class="muted">Missing Supabase client or configuration.</p></div></main>`;
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  window.CutQuestSB = sb;\n\n  const snacks = [
    ["Skyr protein bowl",285,39,15,6,["300 g skyr","25 g whey","10 g almonds"]],
    ["Tuna crunch bowl",315,42,9,12,["1 can tuna","150 g cucumber","80 g avocado","mustard + herbs"]],
    ["Egg & cottage cheese plate",320,31,7,19,["3 eggs","150 g cottage cheese","tomatoes + herbs"]],
    ["Protein pudding",245,36,12,5,["250 g fromage blanc 0%","30 g whey","cocoa + sweetener"]]
  ];
  const dinners = [
    ["Steakhouse bowl",1265,106,24,79,["250 g lean beef steak","2 eggs","large green salad","100 g avocado","30 g feta"]],
    ["Chicken shawarma plate",1225,112,28,70,["300 g chicken thigh","Greek-style salad","150 g tzatziki","100 g avocado"]],
    ["Salmon power plate",1240,99,26,80,["250 g salmon","250 g courgette","2 eggs","200 g skyr herb dip"]],
    ["Paprika chicken & feta",1230,108,32,69,["320 g chicken breast","peppers + courgette","70 g feta","150 g Greek yogurt"]]
  ];

  let user=null,profile=null,log=null,meals=[],history=[],weighins=[];
  const today=()=>new Date().toISOString().slice(0,10);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  function showLogin(message=""){
    user=null;
    root.innerHTML=`
      <main class="auth-wrap">
        <section class="auth-card">
          <div class="logo">CQ</div>
          <p class="eyebrow">CUTQUEST</p>
          <h1>Your cut,<br>remembered.</h1>
          <p class="muted">Sign in to sync meal plans, logged food and progress.</p>
          <input id="email" type="email" placeholder="Email" autocomplete="email">
          <input id="password" type="password" placeholder="Password" autocomplete="current-password">
          <div class="auth-buttons">
            <button class="btn primary" id="signIn">Sign in</button>
            <button class="btn ghost" id="createOwner">Create owner</button>
          </div>
          <div id="authMessage" class="tiny muted notice">${esc(message)}</div>
        </section>
      </main>`;
    document.querySelector("#signIn").onclick=signIn;
    document.querySelector("#createOwner").onclick=createOwner;
  }

  async function signIn(){
    const email=document.querySelector("#email").value.trim();
    const password=document.querySelector("#password").value;
    const msg=document.querySelector("#authMessage");
    msg.textContent="Signing in…";
    const {error}=await sb.auth.signInWithPassword({email,password});
    msg.textContent=error?error.message:"Signed in.";
  }

  async function createOwner(){
    const email=document.querySelector("#email").value.trim();
    const password=document.querySelector("#password").value;
    const msg=document.querySelector("#authMessage");
    if(!email||password.length<8){
      msg.textContent="Use a valid email and a password of at least 8 characters.";
      return;
    }
    msg.textContent="Creating owner account…";
    try{
      const res=await fetch(cfg.OWNER_CREATE_URL,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password})
      });
      const data=await res.json();
      if(!res.ok){msg.textContent=data.error||"Could not create owner.";return;}
      await signIn();
    }catch(e){msg.textContent=e.message||"Could not create owner.";}
  }

  function mealRow(arr,type,time){
    return {
      user_id:user.id,daily_log_id:log.id,meal_type:type,planned_time:time,
      name:arr[0],calories:arr[1],protein_g:arr[2],carbs_g:arr[3],fat_g:arr[4],
      ingredients:arr[5],source:"generated",completed:false
    };
  }

  function pick(list,oldName){
    const options=list.filter(x=>x[0]!==oldName);
    return options[Math.floor(Math.random()*options.length)]||list[0];
  }

  async function enter(u){
    user=u;
    let r=await sb.from("profiles").select("*").eq("id",u.id).maybeSingle();
    if(!r.data){
      const ins=await sb.from("profiles").insert({id:u.id});
      if(ins.error)return showLogin(ins.error.message);
      r=await sb.from("profiles").select("*").eq("id",u.id).single();
    }
    profile=r.data;

    r=await sb.from("daily_logs").select("*").eq("user_id",u.id).eq("log_date",today()).maybeSingle();
    if(!r.data){
      r=await sb.from("daily_logs").insert({
        user_id:u.id,log_date:today(),
        calorie_target:profile.calorie_target,protein_target:profile.protein_target
      }).select().single();
    }
    if(r.error)return showLogin(r.error.message);
    log=r.data;

    r=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    meals=r.data||[];
    if(!meals.length)await generate(false);
    await loadHistory();
    await updateProgress();
    render();
  }

  async function generate(ask=true){
    if(ask&&meals.some(x=>x.completed)&&!confirm("Regenerate today and clear check-offs?"))return;
    const snack=pick(snacks,meals.find(x=>x.meal_type==="snack")?.name);
    const dinner=[...dinners].sort((a,b)=>
      Math.abs(a[1]+snack[1]-Number(profile.calorie_target))-
      Math.abs(b[1]+snack[1]-Number(profile.calorie_target))
    )[0];
    await sb.from("meals").delete().eq("daily_log_id",log.id).eq("source","generated");
    const r=await sb.from("meals").insert([
      mealRow(snack,"snack",profile.eating_window_start||"16:00"),
      mealRow(dinner,"dinner",profile.eating_window_end||"17:45")
    ]).select();
    if(r.error)return alert(r.error.message);
    meals=r.data||[];
    await syncDay();
  }

  function totals(doneOnly=false){
    return meals.filter(m=>!doneOnly||m.completed).reduce((a,m)=>{
      a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);
      a.c+=Number(m.carbs_g||0);a.f+=Number(m.fat_g||0);return a;
    },{kcal:0,p:0,c:0,f:0});
  }

  async function syncDay(){
    const t=totals(true);
    const completed=meals.length>0&&meals.every(x=>x.completed);
    const logged=meals.filter(x=>x.completed).length;
    const xp=logged*25+(completed?50:0);
    const r=await sb.from("daily_logs").update({
      calories:t.kcal,protein_g:t.p,carbs_g:t.c,fat_g:t.f,
      completed,xp_earned:xp,updated_at:new Date().toISOString()
    }).eq("id",log.id).select().single();
    if(r.data)log=r.data;
    await loadHistory();
    await updateProgress();
    render();
  }

  async function updateProgress(){
    const r=await sb.from("daily_logs").select("log_date,completed,xp_earned")
      .eq("user_id",user.id).order("log_date",{ascending:false});
    const days=r.data||[];
    const xp=days.reduce((a,x)=>a+Number(x.xp_earned||0),0);
    const completeSet=new Set(days.filter(x=>x.completed).map(x=>x.log_date));
    let streak=0;
    const cursor=new Date();
    while(completeSet.has(cursor.toISOString().slice(0,10))){
      streak+=1;
      cursor.setDate(cursor.getDate()-1);
    }
    const existing=await sb.from("progress").select("*").eq("user_id",user.id).maybeSingle();
    const longest=Math.max(streak,Number(existing.data?.longest_streak||0));
    await sb.from("progress").upsert({
      user_id:user.id,xp,current_streak:streak,longest_streak:longest,
      last_completed_date:days.find(x=>x.completed)?.log_date||null,
      updated_at:new Date().toISOString()
    });
  }

  async function toggleMeal(id){
    const m=meals.find(x=>x.id===id);
    if(!m)return;
    const next=!m.completed;
    const r=await sb.from("meals").update({
      completed:next,eaten_at:next?new Date().toISOString():null
    }).eq("id",id).select().single();
    if(r.error)return alert(r.error.message);
    Object.assign(m,r.data);
    await syncDay();
  }

  async function reroll(type){
    const m=meals.find(x=>x.meal_type===type);
    if(!m||m.completed)return;
    const source=type==="snack"?snacks:dinners;
    const fresh=pick(source,m.name);
    const r=await sb.from("meals").update({
      name:fresh[0],calories:fresh[1],protein_g:fresh[2],
      carbs_g:fresh[3],fat_g:fresh[4],ingredients:fresh[5]
    }).eq("id",m.id).select().single();
    if(r.error)return alert(r.error.message);
    Object.assign(m,r.data);
    render();
  }

  async function loadHistory(){
    history=(await sb.from("daily_logs").select("*").eq("user_id",user.id)
      .order("log_date",{ascending:false}).limit(14)).data||[];
    weighins=(await sb.from("weigh_ins").select("*").eq("user_id",user.id)
      .order("measured_on",{ascending:false}).limit(14)).data||[];
  }

  async function saveWeight(){
    const weight=Number(document.querySelector("#weight").value);
    const bfRaw=document.querySelector("#bodyfat").value;
    if(!weight)return;
    const r=await sb.from("weigh_ins").upsert({
      user_id:user.id,measured_on:today(),weight_kg:weight,
      body_fat_pct:bfRaw?Number(bfRaw):null
    },{onConflict:"user_id,measured_on"}).select().single();
    if(r.error)return alert(r.error.message);
    await loadHistory();
    render();
  }

  async function saveSettings(){
    const calories=Number(document.querySelector("#calorieTarget").value);
    const protein=Number(document.querySelector("#proteinTarget").value);
    const snackTime=document.querySelector("#snackTime").value;
    const dinnerTime=document.querySelector("#dinnerTime").value;
    const r=await sb.from("profiles").update({
      calorie_target:calories,protein_target:protein,
      eating_window_start:snackTime,eating_window_end:dinnerTime,
      updated_at:new Date().toISOString()
    }).eq("id",user.id).select().single();
    if(r.error)return alert(r.error.message);
    profile=r.data;
    const lr=await sb.from("daily_logs").update({
      calorie_target:calories,protein_target:protein,updated_at:new Date().toISOString()
    }).eq("id",log.id).select().single();
    if(lr.data)log=lr.data;
    render();
  }

  function mealCard(m){
    return `
      <article class="card meal ${m.completed?"done":""}">
        <p class="eyebrow">${esc(m.meal_type.toUpperCase())} · ${esc((m.planned_time||"").slice(0,5))}</p>
        <h3>${esc(m.name)}</h3>
        <div class="pills">
          <span class="pill">${Math.round(m.calories)} kcal</span>
          <span class="pill">${Math.round(m.protein_g)}g P</span>
          <span class="pill">${Math.round(m.carbs_g)}g C</span>
          <span class="pill">${Math.round(m.fat_g)}g F</span>
        </div>
        <ul>${(m.ingredients||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
        <div class="meal-actions">
          <button class="btn ghost" data-reroll="${esc(m.meal_type)}" ${m.completed?"disabled":""}>Reroll</button>
          <button class="btn ${m.completed?"primary":"ghost"}" data-toggle="${esc(m.id)}">${m.completed?"✓ Logged":"✓ Mark eaten"}</button>
        </div>
      </article>`;
  }

  function render(){
    const plan=meals.filter(m=>m.source==="generated").reduce((a,m)=>{a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);a.c+=Number(m.carbs_g||0);a.f+=Number(m.fat_g||0);return a;},{kcal:0,p:0,c:0,f:0});
    const recent7=history.slice(0,7);
    const avg=recent7.length?Math.round(recent7.reduce((a,x)=>a+Number(x.calories||0),0)/recent7.length):"—";
    const proteinHit=recent7.length?`${recent7.filter(x=>Number(x.protein_g)>=Number(x.protein_target)).length}/${recent7.length}`:"—";
    const latestWeight=weighins[0]?`${Number(weighins[0].weight_kg).toFixed(1)} kg`:"—";
    const planDelta=Math.round(plan.kcal-Number(profile.calorie_target));

    root.innerHTML=`
      <main class="wrap">
        <header class="top">
          <div class="brand">
            <div class="logo">CQ</div>
            <div><div class="brand-title">CutQuest</div><div class="tiny muted">${esc(user.email)}</div></div>
          </div>
          <div class="actions">
            <button id="saveSettings" class="btn ghost">Save settings</button>
            <button id="signOut" class="btn ghost">Sign out</button>
          </div>
        </header>

        <section class="settings card">
          <div><label>Calories</label><input id="calorieTarget" type="number" value="${Number(profile.calorie_target)}"></div>
          <div><label>Protein g</label><input id="proteinTarget" type="number" value="${Number(profile.protein_target)}"></div>
          <div><label>Snack</label><input id="snackTime" type="time" value="${String(profile.eating_window_start||"16:00").slice(0,5)}"></div>
          <div><label>Dinner</label><input id="dinnerTime" type="time" value="${String(profile.eating_window_end||"17:45").slice(0,5)}"></div>
        </section>

        <nav class="tabs">
          <button class="tab on" data-tab="today">Today</button>
          <button class="tab" data-tab="progress">Progress</button>
        </nav>

        <section id="today" class="panel on">
          <div class="hero">
            <div>
              <p class="eyebrow">TODAY'S MISSION</p>
              <h1>Hit the target.<br>Keep the streak alive.</h1>
              <p class="muted">${Number(profile.calorie_target)} kcal · ${Number(profile.protein_target)}g protein</p>
            </div>
            <button id="generate" class="btn primary">Generate day</button>
          </div>

          <div class="grid3">
            <div class="card stat"><span>Calories logged</span><strong>${Math.round(Number(log.calories||0))}</strong></div>
            <div class="card stat"><span>Protein logged</span><strong>${Math.round(Number(log.protein_g||0))} g</strong></div>
            <div class="card stat"><span>XP today</span><strong>${Number(log.xp_earned||0)}</strong></div>
          </div>

          <div class="progress-strip">
            <div><div class="tiny"><b>TODAY'S PLAN</b></div><strong>${Math.round(plan.kcal)} kcal · ${Math.round(plan.p)}g protein</strong></div>
            <strong>${planDelta>0?"+":""}${planDelta} kcal</strong>
          </div>

          <div class="meals">${meals.map(mealCard).join("")}</div>
        </section>

        <section id="progress" class="panel">
          <div class="hero">
            <div>
              <p class="eyebrow">PROGRESS</p>
              <h1>Receipts,<br>not vibes.</h1>
              <p class="muted">Your daily logs and weigh-ins are stored in Supabase.</p>
            </div>
          </div>

          <div class="card form-grid">
            <div><label>Weight kg</label><input id="weight" type="number" step=".1"></div>
            <div><label>Body fat %</label><input id="bodyfat" type="number" step=".1"></div>
            <button id="saveWeight" class="btn primary">Save weigh-in</button>
          </div>

          <div class="grid3">
            <div class="card stat"><span>7-day avg kcal</span><strong>${avg}</strong></div>
            <div class="card stat"><span>Protein hit</span><strong>${proteinHit}</strong></div>
            <div class="card stat"><span>Latest weight</span><strong>${latestWeight}</strong></div>
          </div>

          <div class="card">
            <p class="eyebrow">RECENT DAYS</p>
            ${history.length?history.map(x=>`
              <div class="history-row">
                <span>${esc(x.log_date)}</span>
                <span>${Math.round(Number(x.calories||0))} kcal</span>
                <span>${Math.round(Number(x.protein_g||0))}g P</span>
                <span>+${Number(x.xp_earned||0)} XP</span>
                <span class="${x.completed?"good":"muted"}">${x.completed?"Complete":"Open"}</span>
              </div>`).join(""):`<p class="muted">No history yet. Today is page one.</p>`}
          </div>
        </section>

        <p class="footer">CutQuest · synced with Supabase · protected by row-level security</p>
      </main>`;

    document.querySelector("#signOut").onclick=()=>sb.auth.signOut();
    document.querySelector("#saveSettings").onclick=saveSettings;
    document.querySelector("#generate").onclick=()=>generate(true);
    document.querySelector("#saveWeight").onclick=saveWeight;
    document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>toggleMeal(b.dataset.toggle));
    document.querySelectorAll("[data-reroll]").forEach(b=>b.onclick=()=>reroll(b.dataset.reroll));
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x===b));
      document.querySelectorAll(".panel").forEach(panel=>panel.classList.toggle("on",panel.id===b.dataset.tab));
    });
  }

  sb.auth.onAuthStateChange(async(_event,session)=>{
    if(session?.user&&(!user||user.id!==session.user.id))await enter(session.user);
    if(!session)showLogin();
  });

  sb.auth.getSession().then(async({data})=>{
    if(data.session?.user)await enter(data.session.user);
    else showLogin();
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
  }
})();
