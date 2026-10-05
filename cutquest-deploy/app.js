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

  window.CutQuestSB = sb;

  const snacks = [
    ["Skyr protein bowl",285,39,15,6,["300 g skyr","25 g whey","10 g almonds"],13],
    ["Tuna crunch bowl",315,42,9,12,["1 can tuna","150 g cucumber","80 g avocado","mustard + herbs"],5],
    ["Egg & cottage cheese plate",320,31,7,19,["3 eggs","150 g cottage cheese","tomatoes + herbs"],5],
    ["Protein pudding",245,36,12,5,["250 g fromage blanc 0%","30 g whey","cocoa + sweetener"],10]
  ];
  const dinners = [
    ["Steakhouse bowl",1265,106,24,79,["250 g lean beef steak","2 eggs","large green salad","100 g avocado","30 g feta"],14],
    ["Chicken shawarma plate",1225,112,28,70,["300 g chicken thigh","Greek-style salad","150 g tzatziki","100 g avocado"],18],
    ["Salmon power plate",1240,99,26,80,["250 g salmon","250 g courgette","2 eggs","200 g skyr herb dip"],15],
    ["Paprika chicken & feta",1230,108,32,69,["320 g chicken breast","peppers + courgette","70 g feta","150 g Greek yogurt"],22]
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
      net_carbs_g:arr[6]??arr[3],ingredients:arr[5],source:"generated",completed:false
    };
  }

  function pick(list,oldName){
    const options=list.filter(x=>x[0]!==oldName);
    return options[Math.floor(Math.random()*options.length)]||list[0];
  }

  const round1=n=>Math.round(Number(n||0)*10)/10;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

  function recipeList(type){
    return type==="snack"?snacks:dinners;
  }

  function formatCount(n,unit){
    if(unit==="egg"||unit==="eggs"){
      const rounded=Math.max(.5,Math.round(n*2)/2);
      const label=rounded===1?"egg":"eggs";
      return `${rounded%1===0?rounded.toFixed(0):rounded.toFixed(1)} ${label}`;
    }
    if(unit==="can"||unit==="cans"){
      const rounded=Math.max(.5,Math.round(n*2)/2);
      const label=rounded===1?"can":"cans";
      return `${rounded%1===0?rounded.toFixed(0):rounded.toFixed(1)} ${label}`;
    }
    return null;
  }

  function scaleIngredient(text,factor){
    const g=text.match(/^([0-9]+(?:\.[0-9]+)?)\s*g\s+(.+)$/i);
    if(g){
      const grams=Math.max(1,Math.round(Number(g[1])*factor/5)*5);
      return `${grams} g ${g[2]}`;
    }

    const count=text.match(/^([0-9]+(?:\.[0-9]+)?)\s+(egg|eggs|can|cans)\b\s*(.*)$/i);
    if(count){
      const scaled=formatCount(Number(count[1])*factor,count[2].toLowerCase());
      return scaled+(count[3]?` ${count[3]}`:"");
    }

    if(/^large green salad$/i.test(text)){
      if(factor<.45) return "small green salad";
      if(factor<.8) return "medium green salad";
      return "large green salad";
    }

    if(/salad|peppers|herbs|mustard/i.test(text)&&factor<.75){
      return `small portion of ${text.toLowerCase()}`;
    }

    return text;
  }

  function portionRecipe(arr,kcalBudget){
    const baseKcal=Number(arr[1]||1);
    const factor=clamp(Number(kcalBudget||0)/baseKcal,0.05,1.35);
    const ingredients=arr[5].map(x=>scaleIngredient(x,factor));
    return {
      name:arr[0],
      calories:Math.max(1,Math.round(baseKcal*factor)),
      protein_g:round1(arr[2]*factor),
      carbs_g:round1(arr[3]*factor),
      net_carbs_g:round1((arr[6]??arr[3])*factor),
      fat_g:round1(arr[4]*factor),
      ingredients
    };
  }

  function completedTotals(list){
    return list.filter(m=>m.completed).reduce((a,m)=>{
      a.kcal+=Number(m.calories||0);
      a.p+=Number(m.protein_g||0);
      a.c+=Number(m.carbs_g||0);
      a.nc+=Number(m.net_carbs_g??m.carbs_g??0);
      a.f+=Number(m.fat_g||0);
      return a;
    },{kcal:0,p:0,c:0,nc:0,f:0});
  }

  function chooseRecipe(type,currentName,kcalBudget,proteinBudget,netBudget,forceDifferent=false){
    let list=recipeList(type);
    if(forceDifferent&&list.length>1) list=list.filter(x=>x[0]!==currentName);
    let best=null;
    for(const arr of list){
      const scaled=portionRecipe(arr,kcalBudget);
      const proteinGap=Math.abs(scaled.protein_g-Number(proteinBudget||0));
      const netOver=Math.max(0,scaled.net_carbs_g-Number(netBudget||0));
      const changePenalty=!forceDifferent&&currentName&&arr[0]!==currentName?18:0;
      const score=proteinGap*5+netOver*10+Math.abs(scaled.calories-kcalBudget)*0.05+changePenalty;
      if(!best||score<best.score) best={arr,scaled,score};
    }
    return best?.scaled||portionRecipe(recipeList(type)[0],kcalBudget);
  }

  async function refitRemaining({rerollType=null,randomizeAll=false}={}){
    const latest=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    if(latest.error)return alert(latest.error.message);
    meals=latest.data||[];

    const pending=meals.filter(m=>m.source==="generated"&&!m.completed);
    if(!pending.length){
      if(rerollType||randomizeAll) alert("Your suggested meals for today are already logged.");
      await syncDay();
      return;
    }

    const eaten=completedTotals(meals);
    const remainingKcal=Math.max(0,Number(profile.calorie_target)-eaten.kcal);
    const remainingProtein=Math.max(0,Number(profile.protein_target)-eaten.p);
    const remainingNet=Math.max(0,Number(profile.net_carb_target??30)-eaten.nc);

    const hasSnack=pending.some(m=>m.meal_type==="snack");
    const hasDinner=pending.some(m=>m.meal_type==="dinner");

    for(const m of pending){
      let kcalShare=1/pending.length,proteinShare=1/pending.length,netShare=1/pending.length;
      if(hasSnack&&hasDinner&&pending.length===2){
        if(m.meal_type==="snack"){
          kcalShare=.22; proteinShare=.30; netShare=.30;
        }else{
          kcalShare=.78; proteinShare=.70; netShare=.70;
        }
      }
      const fit=chooseRecipe(
        m.meal_type,
        m.name,
        Math.max(1,remainingKcal*kcalShare),
        remainingProtein*proteinShare,
        remainingNet*netShare,
        randomizeAll||rerollType===m.meal_type
      );
      const r=await sb.from("meals").update({
        name:fit.name,
        calories:fit.calories,
        protein_g:fit.protein_g,
        carbs_g:fit.carbs_g,
        net_carbs_g:fit.net_carbs_g,
        fat_g:fit.fat_g,
        ingredients:fit.ingredients
      }).eq("id",m.id).eq("user_id",user.id).select().single();
      if(r.error)return alert(r.error.message);
    }

    const refreshed=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    meals=refreshed.data||meals;
    await syncDay();
  }

  window.CutQuestRefitPlan=()=>refitRemaining({});

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
        calorie_target:profile.calorie_target,protein_target:profile.protein_target,
        net_carb_target:profile.net_carb_target??30
      }).select().single();
    }
    if(r.error)return showLogin(r.error.message);
    log=r.data;

    r=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    meals=r.data||[];
    if(!meals.some(x=>x.source==="generated"))await generate(false);
    await loadHistory();
    await updateProgress();
    render();
  }

  async function generate(ask=true){
    const latest=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    if(latest.error)return alert(latest.error.message);
    meals=latest.data||[];

    const generated=meals.filter(x=>x.source==="generated");
    if(!generated.length){
      const s=pick(snacks,null);
      const d=pick(dinners,null);
      const r=await sb.from("meals").insert([
        mealRow(s,"snack",profile.eating_window_start||"16:00"),
        mealRow(d,"dinner",profile.eating_window_end||"17:45")
      ]).select();
      if(r.error)return alert(r.error.message);
      meals=[...meals,...(r.data||[])];
    }
    await refitRemaining({randomizeAll:ask});
  }

  function totals(doneOnly=false){
    return meals.filter(m=>!doneOnly||m.completed).reduce((a,m)=>{
      a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);
      a.c+=Number(m.carbs_g||0);a.nc+=Number(m.net_carbs_g??m.carbs_g??0);
      a.f+=Number(m.fat_g||0);return a;
    },{kcal:0,p:0,c:0,nc:0,f:0});
  }

  async function syncDay(){
    const t=totals(true);
    const missionMeals=meals.filter(x=>x.source==="generated");
    const completed=missionMeals.length>0&&missionMeals.every(x=>x.completed);
    const logged=missionMeals.filter(x=>x.completed).length;
    const xp=logged*25+(completed?50:0);
    const r=await sb.from("daily_logs").update({
      calories:t.kcal,protein_g:t.p,carbs_g:t.c,net_carbs_g:t.nc,fat_g:t.f,
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
    const m=meals.find(x=>x.meal_type===type&&x.source==="generated");
    if(!m||m.completed)return;
    await refitRemaining({rerollType:type});
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
    const netCarbs=Number(document.querySelector("#netCarbTarget").value);
    const r=await sb.from("profiles").update({
      calorie_target:calories,protein_target:protein,net_carb_target:netCarbs,
      eating_window_start:snackTime,eating_window_end:dinnerTime,
      updated_at:new Date().toISOString()
    }).eq("id",user.id).select().single();
    if(r.error)return alert(r.error.message);
    profile=r.data;
    const lr=await sb.from("daily_logs").update({
      calorie_target:calories,protein_target:protein,net_carb_target:netCarbs,updated_at:new Date().toISOString()
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
          <span class="pill">${round1(m.net_carbs_g??m.carbs_g)}g net C</span>
          <span class="pill">${round1(m.carbs_g)}g total C</span>
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
    const loggedNow=totals(true);
    const plan=meals.filter(m=>m.source==="generated"&&!m.completed).reduce((a,m)=>{a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);a.c+=Number(m.carbs_g||0);a.nc+=Number(m.net_carbs_g??m.carbs_g??0);a.f+=Number(m.fat_g||0);return a;},{kcal:0,p:0,c:0,nc:0,f:0});
    const remainingKcal=Math.max(0,Number(profile.calorie_target)-loggedNow.kcal);
    const remainingProtein=Math.max(0,Number(profile.protein_target)-loggedNow.p);
    const remainingNet=Math.max(0,Number(profile.net_carb_target??30)-loggedNow.nc);
    const recent7=history.slice(0,7);
    const avg=recent7.length?Math.round(recent7.reduce((a,x)=>a+Number(x.calories||0),0)/recent7.length):"—";
    const proteinHit=recent7.length?`${recent7.filter(x=>Number(x.protein_g)>=Number(x.protein_target)).length}/${recent7.length}`:"—";
    const latestWeight=weighins[0]?`${Number(weighins[0].weight_kg).toFixed(1)} kg`:"—";
    const planDelta=Math.round(plan.kcal-remainingKcal);

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
          <div><label>Net carbs g</label><input id="netCarbTarget" type="number" value="${Number(profile.net_carb_target??30)}"></div>
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
              <p class="muted">${Number(profile.calorie_target)} kcal · ${Number(profile.protein_target)}g protein · ${Number(profile.net_carb_target??30)}g net carbs</p>
            </div>
            <button id="generate" class="btn primary">Generate day</button>
          </div>

          <div class="grid3">
            <div class="card stat"><span>Calories logged</span><strong>${Math.round(Number(log.calories||0))}</strong></div>
            <div class="card stat"><span>Protein logged</span><strong>${Math.round(Number(log.protein_g||0))} g</strong></div>
            <div class="card stat"><span>Net carbs logged</span><strong>${round1(log.net_carbs_g??log.carbs_g)} g</strong></div>
            <div class="card stat"><span>XP today</span><strong>${Number(log.xp_earned||0)}</strong></div>
          </div>

          <div class="progress-strip">
            <div><div class="tiny"><b>REMAINING PLAN</b></div><strong>${Math.round(plan.kcal)} kcal · ${Math.round(plan.p)}g P · ${round1(plan.nc)}g net C</strong></div>
            <strong>${planDelta>0?"+":""}${planDelta} kcal vs remaining</strong>
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
