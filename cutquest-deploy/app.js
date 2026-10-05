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

  let user=null,profile=null,log=null,meals=[],history=[],weighins=[],foods=[],templates=[],settingsOpen=false;
  const today=()=>new Date().toISOString().slice(0,10);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const round1=n=>Math.round(Number(n||0)*10)/10;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

  function weightedPick(items,weightFn){
    if(!items.length)return null;
    const weighted=items.map(item=>({item,w:Math.max(.01,Number(weightFn(item)||.01))}));
    const total=weighted.reduce((a,x)=>a+x.w,0);
    let cursor=Math.random()*total;
    for(const x of weighted){
      cursor-=x.w;
      if(cursor<=0)return x.item;
    }
    return weighted[weighted.length-1].item;
  }

  function foodWeight(food){
    const pref=Number(food.preference_score||5)+1;
    const sat=food.saturated_fat_level==="high"?.42:food.saturated_fat_level==="medium"?.8:1;
    return pref*pref*sat;
  }

  function hasRole(food,role){
    return Array.isArray(food.roles)&&food.roles.includes(role);
  }

  function pickFood(role,avoidIds=[]){
    let candidates=foods.filter(f=>f.enabled!==false&&hasRole(f,role)&&!avoidIds.includes(f.id));
    if(!candidates.length)candidates=foods.filter(f=>f.enabled!==false&&hasRole(f,role));
    return weightedPick(candidates,foodWeight);
  }

  function chooseTemplate(type,currentId=null,forceDifferent=false){
    let pool=templates.filter(t=>t.enabled!==false&&t.meal_type===type);
    if(forceDifferent&&pool.length>1){
      const changed=pool.filter(t=>t.id!==currentId);
      if(changed.length)pool=changed;
    }
    return weightedPick(pool,t=>Number(t.weight||5));
  }

  function amountCandidates(food,optional=false){
    const min=Number(food.min_portion_g);
    const max=Number(food.max_portion_g);
    const step=Math.max(1,Number(food.portion_step_g||5));
    let vals=[];
    for(let g=min;g<=max+.001;g+=step)vals.push(round1(g));
    const def=clamp(Number(food.default_portion_g||min),min,max);
    vals.push(round1(def));
    vals=[...new Set(vals)].sort((a,b)=>a-b);
    if(vals.length>9){
      const sampled=[];
      for(let i=0;i<9;i++) sampled.push(vals[Math.round(i*(vals.length-1)/8)]);
      vals=[...new Set(sampled.concat([round1(def)]))].sort((a,b)=>a-b);
    }
    if(optional)vals.unshift(0);
    return [...new Set(vals)];
  }

  function foodMacros(food,grams){
    const factor=Number(grams||0)/100;
    return {
      kcal:Number(food.calories_per_100g||0)*factor,
      p:Number(food.protein_g_per_100g||0)*factor,
      c:Number(food.carbs_g_per_100g||0)*factor,
      nc:Number(food.net_carbs_g_per_100g||0)*factor,
      fiber:Number(food.fiber_g_per_100g||0)*factor,
      f:Number(food.fat_g_per_100g||0)*factor
    };
  }

  function formatIngredient(food,grams){
    if(Number(food.grams_per_unit)>0&&food.unit_label&&food.unit_label!=="g"){
      const units=round1(Number(grams)/Number(food.grams_per_unit));
      const shown=Number.isInteger(units)?String(units):units.toFixed(1);
      const unit=food.unit_label==="egg"?(units===1?"egg":"eggs"):food.unit_label;
      return `${shown} ${unit}`;
    }
    return `${Math.round(Number(grams))} g ${food.name.toLowerCase()}`;
  }

  function optimizeMeal(selected,target){
    const choices=selected.map(x=>amountCandidates(x.food,x.optional));
    let best=null;

    function walk(i,amounts){
      if(i===selected.length){
        const total={kcal:0,p:0,c:0,nc:0,fiber:0,f:0};
        let satPenalty=0;
        let active=0;
        for(let j=0;j<selected.length;j++){
          const grams=amounts[j];
          if(grams<=0)continue;
          active+=1;
          const m=foodMacros(selected[j].food,grams);
          total.kcal+=m.kcal;total.p+=m.p;total.c+=m.c;total.nc+=m.nc;total.fiber+=m.fiber;total.f+=m.f;
          if(selected[j].food.saturated_fat_level==="high")satPenalty+=grams*.035;
          else if(selected[j].food.saturated_fat_level==="medium")satPenalty+=grams*.008;
        }
        const kcalGap=Math.abs(total.kcal-target.kcal);
        const proteinUnder=Math.max(0,target.p-total.p);
        const proteinOver=Math.max(0,total.p-target.p);
        const netOver=Math.max(0,total.nc-target.nc);
        const emptyPenalty=active<2?80:0;
        const score=kcalGap*.18+proteinUnder*6+proteinOver*.65+netOver*24+satPenalty+emptyPenalty;
        if(!best||score<best.score)best={score,total,amounts:[...amounts]};
        return;
      }
      for(const g of choices[i]){
        amounts[i]=g;
        walk(i+1,amounts);
      }
    }

    walk(0,[]);
    if(!best)return null;

    const components=selected.map((x,i)=>({
      slot:x.slot,
      food_id:x.food.id,
      name:x.food.name,
      grams:Number(best.amounts[i]||0)
    })).filter(x=>x.grams>0);

    return {
      components,
      ingredients:components.map(comp=>{
        const food=foods.find(f=>f.id===comp.food_id);
        return formatIngredient(food,comp.grams);
      }),
      calories:Math.round(best.total.kcal),
      protein_g:round1(best.total.p),
      carbs_g:round1(best.total.c),
      net_carbs_g:round1(best.total.nc),
      fiber_g:round1(best.total.fiber),
      fat_g:round1(best.total.f)
    };
  }

  function simpleFoodName(name){
    return String(name||"").replace(/,.*$/,"").replace(/\s+5%$/,"").trim();
  }

  function generatedMealName(template,components){
    const bySlot=key=>components.find(x=>x.slot===key)?.name;
    const protein=simpleFoodName(bySlot("protein"));
    const veg=simpleFoodName(bySlot("veg"));
    const base=simpleFoodName(bySlot("base"));
    const accent=simpleFoodName(bySlot("accent"));

    if(template.id==="protein_veg_bowl")return `${protein} & ${veg} bowl`;
    if(template.id==="protein_salad")return `${protein} salad bowl`;
    if(template.id==="fish_veg")return `${protein} with ${veg}`;
    if(template.id==="egg_pan")return accent?`${veg} egg & ${accent} pan`:`${veg} egg pan`;
    if(template.id==="skyr_bowl")return `${base} protein bowl`;
    if(template.id==="savory_snack")return `${protein} snack plate`;
    return template.name;
  }

  function rebuildSelectionFromMeal(meal,template){
    if(!meal||!Array.isArray(meal.components)||!meal.components.length)return null;
    const selected=[];
    for(const slot of template.slots||[]){
      const old=meal.components.find(c=>c.slot===slot.key);
      if(!old){
        if(slot.required)return null;
        continue;
      }
      const food=foods.find(f=>f.id===old.food_id);
      if(!food)return null;
      selected.push({slot:slot.key,food,optional:!slot.required});
    }
    return selected.length?selected:null;
  }

  function freshSelection(template,currentMeal=null){
    const selected=[];
    const used=[];
    const oldIds=Array.isArray(currentMeal?.components)?currentMeal.components.map(x=>x.food_id):[];
    for(const slot of template.slots||[]){
      const avoid=[...used,...oldIds];
      const food=pickFood(slot.role,avoid)||pickFood(slot.role,used);
      if(!food){
        if(slot.required)return null;
        continue;
      }
      selected.push({slot:slot.key,food,optional:!slot.required});
      used.push(food.id);
    }
    return selected;
  }

  function buildIngredientMeal(type,target,currentMeal=null,forceNew=false){
    let template=null,selected=null;
    if(!forceNew&&currentMeal?.template_id){
      template=templates.find(t=>t.id===currentMeal.template_id&&t.meal_type===type);
      if(template)selected=rebuildSelectionFromMeal(currentMeal,template);
    }
    if(!template||!selected){
      template=chooseTemplate(type,currentMeal?.template_id||null,forceNew);
      if(!template)return null;
      selected=freshSelection(template,currentMeal);
    }
    if(!selected)return null;

    const fit=optimizeMeal(selected,target);
    if(!fit)return null;
    return {
      ...fit,
      template_id:template.id,
      name:generatedMealName(template,fit.components)
    };
  }

  function completedTotals(list){
    return list.filter(m=>m.completed).reduce((a,m)=>{
      a.kcal+=Number(m.calories||0);
      a.p+=Number(m.protein_g||0);
      a.c+=Number(m.carbs_g||0);
      a.nc+=Number(m.net_carbs_g??m.carbs_g??0);
      a.fiber+=Number(m.fiber_g||0);
      a.f+=Number(m.fat_g||0);
      return a;
    },{kcal:0,p:0,c:0,nc:0,fiber:0,f:0});
  }

  function remainingTargets(list){
    const eaten=completedTotals(list);
    return {
      kcal:Math.max(0,Number(profile.calorie_target)-eaten.kcal),
      p:Math.max(0,Number(profile.protein_target)-eaten.p),
      nc:Math.max(0,Number(profile.net_carb_target??30)-eaten.nc)
    };
  }

  function mealShares(pending,type){
    const hasSnack=pending.some(m=>m.meal_type==="snack");
    const hasDinner=pending.some(m=>m.meal_type==="dinner");
    if(hasSnack&&hasDinner&&pending.length===2){
      return type==="snack"
        ? {kcal:.22,p:.30,nc:.30}
        : {kcal:.78,p:.70,nc:.70};
    }
    return {kcal:1/pending.length,p:1/pending.length,nc:1/pending.length};
  }

  function mealRowFromFit(fit,type,time){
    return {
      user_id:user.id,
      daily_log_id:log.id,
      meal_type:type,
      planned_time:time,
      name:fit.name,
      calories:fit.calories,
      protein_g:fit.protein_g,
      carbs_g:fit.carbs_g,
      net_carbs_g:fit.net_carbs_g,
      fiber_g:fit.fiber_g,
      fat_g:fit.fat_g,
      ingredients:fit.ingredients,
      components:fit.components,
      template_id:fit.template_id,
      source:"generated",
      completed:false
    };
  }

  async function refitRemaining({rerollType=null,randomizeAll=false}={}){
    const latest=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    if(latest.error)return alert(latest.error.message);
    meals=latest.data||[];

    const pending=meals.filter(m=>m.source==="generated"&&!m.completed);
    if(!pending.length){
      if(rerollType||randomizeAll)alert("Your suggested meals for today are already logged.");
      await syncDay();
      return;
    }

    const remain=remainingTargets(meals);

    for(const m of pending){
      const share=mealShares(pending,m.meal_type);
      const target={
        kcal:Math.max(1,remain.kcal*share.kcal),
        p:Math.max(0,remain.p*share.p),
        nc:Math.max(0,remain.nc*share.nc)
      };
      const forceNew=randomizeAll||rerollType===m.meal_type;
      const fit=buildIngredientMeal(m.meal_type,target,m,forceNew);
      if(!fit)continue;

      const r=await sb.from("meals").update({
        name:fit.name,
        calories:fit.calories,
        protein_g:fit.protein_g,
        carbs_g:fit.carbs_g,
        net_carbs_g:fit.net_carbs_g,
        fat_g:fit.fat_g,
        ingredients:fit.ingredients,
        components:fit.components,
        template_id:fit.template_id
      }).eq("id",m.id).eq("user_id",user.id).select().single();
      if(r.error)return alert(r.error.message);
    }

    const refreshed=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    meals=refreshed.data||meals;
    await syncDay();
  }

  window.CutQuestRefitPlan=()=>refitRemaining({});

  function showLogin(message=""){
    user=null;
    root.innerHTML=`
      <main class="auth-wrap">
        <div class="auth-card">
          <div class="logo">CQ</div>
          <p class="eyebrow">CUTQUEST</p>
          <h1>Welcome back.</h1>
          <div class="form-grid">
            <div>
              <label>Email</label>
              <input id="authEmail" type="email" autocomplete="email" inputmode="email">
            </div>
            <div>
              <label>Password</label>
              <input id="authPassword" type="password" autocomplete="current-password">
            </div>
          </div>
          <p id="authMsg" class="tiny muted">${esc(message)}</p>
          <button id="authSignIn" class="btn primary full">Sign in</button>
          <button id="authCreate" class="btn ghost full" style="margin-top:8px">Create owner account</button>
        </div>
      </main>`;

    const email=document.querySelector("#authEmail");
    const password=document.querySelector("#authPassword");
    const msg=document.querySelector("#authMsg");
    const signIn=document.querySelector("#authSignIn");
    const create=document.querySelector("#authCreate");

    async function doSignIn(){
      const e=email.value.trim();
      const p=password.value;
      if(!e||!p){
        msg.textContent="Enter your email and password.";
        return;
      }
      signIn.disabled=true;
      create.disabled=true;
      msg.textContent="Signing in…";
      const {error}=await sb.auth.signInWithPassword({email:e,password:p});
      if(error){
        msg.textContent=error.message;
        signIn.disabled=false;
        create.disabled=false;
      }
    }

    async function doCreate(){
      const e=email.value.trim();
      const p=password.value;
      if(!e||!p){
        msg.textContent="Enter an email and password.";
        return;
      }
      signIn.disabled=true;
      create.disabled=true;
      msg.textContent="Creating account…";
      try{
        const res=await fetch(cfg.OWNER_CREATE_URL,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({email:e,password:p})
        });
        const body=await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(body.error||body.message||"Could not create account.");
        const {error}=await sb.auth.signInWithPassword({email:e,password:p});
        if(error) throw error;
      }catch(err){
        msg.textContent=err.message||"Could not create account.";
        signIn.disabled=false;
        create.disabled=false;
      }
    }

    signIn.onclick=doSignIn;
    create.onclick=doCreate;
    password.addEventListener("keydown",e=>{if(e.key==="Enter")doSignIn();});
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

    const [foodResult,templateResult]=await Promise.all([
      sb.from("food_items").select("*").eq("enabled",true).order("preference_score",{ascending:false}),
      sb.from("meal_templates").select("*").eq("enabled",true).order("weight",{ascending:false})
    ]);
    if(foodResult.error)return showLogin("Could not load food catalogue: "+foodResult.error.message);
    if(templateResult.error)return showLogin("Could not load meal templates: "+templateResult.error.message);
    foods=foodResult.data||[];
    templates=templateResult.data||[];
    if(!foods.length||!templates.length)return showLogin("The CutQuest food engine is empty.");

    r=await sb.from("daily_logs").select("*").eq("user_id",u.id).eq("log_date",today()).maybeSingle();
    if(!r.data){
      r=await sb.from("daily_logs").insert({
        user_id:u.id,log_date:today(),
        calorie_target:profile.calorie_target,protein_target:profile.protein_target,
        net_carb_target:profile.net_carb_target??30,fiber_target:profile.fiber_target??30
      }).select().single();
    }
    if(r.error)return showLogin(r.error.message);
    log=r.data;

    r=await sb.from("meals").select("*").eq("daily_log_id",log.id).order("created_at");
    meals=r.data||[];

    if(!meals.some(x=>x.source==="generated")){
      await generate(false);
      return;
    }

    const needsUpgrade=meals.some(m=>
      m.source==="generated"&&!m.completed&&
      (!m.template_id||!Array.isArray(m.components)||!m.components.length)
    );
    if(needsUpgrade){
      await refitRemaining({});
      return;
    }

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
      const pending=[{meal_type:"snack"},{meal_type:"dinner"}];
      const remain=remainingTargets(meals);
      const rows=[];

      for(const item of pending){
        const share=mealShares(pending,item.meal_type);
        const target={
          kcal:Math.max(1,remain.kcal*share.kcal),
          p:Math.max(0,remain.p*share.p),
          nc:Math.max(0,remain.nc*share.nc)
        };
        const fit=buildIngredientMeal(item.meal_type,target,null,true);
        if(!fit)continue;
        const time=item.meal_type==="snack"
          ? (profile.eating_window_start||"16:00")
          : (profile.eating_window_end||"17:45");
        rows.push(mealRowFromFit(fit,item.meal_type,time));
      }

      if(!rows.length)return alert("CutQuest could not assemble a meal from the food catalogue.");
      const inserted=await sb.from("meals").insert(rows).select();
      if(inserted.error)return alert(inserted.error.message);
      meals=[...meals,...(inserted.data||[])];
      await syncDay();
      return;
    }

    await refitRemaining({randomizeAll:ask});
  }

  function totals(doneOnly=false){
    return meals.filter(m=>!doneOnly||m.completed).reduce((a,m)=>{
      a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);
      a.c+=Number(m.carbs_g||0);a.nc+=Number(m.net_carbs_g??m.carbs_g??0);
      a.fiber+=Number(m.fiber_g||0);a.f+=Number(m.fat_g||0);return a;
    },{kcal:0,p:0,c:0,nc:0,fiber:0,f:0});
  }

  async function syncDay(){
    const t=totals(true);
    const missionMeals=meals.filter(x=>x.source==="generated");
    const completed=missionMeals.length>0&&missionMeals.every(x=>x.completed);
    const logged=missionMeals.filter(x=>x.completed).length;
    const xp=logged*25+(completed?50:0);
    const r=await sb.from("daily_logs").update({
      calories:t.kcal,protein_g:t.p,carbs_g:t.c,net_carbs_g:t.nc,fiber_g:t.fiber,fat_g:t.f,
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
    const fiber=Number(document.querySelector("#fiberTarget").value);
    const r=await sb.from("profiles").update({
      calorie_target:calories,protein_target:protein,net_carb_target:netCarbs,fiber_target:fiber,
      eating_window_start:snackTime,eating_window_end:dinnerTime,
      updated_at:new Date().toISOString()
    }).eq("id",user.id).select().single();
    if(r.error)return alert(r.error.message);
    profile=r.data;
    const lr=await sb.from("daily_logs").update({
      calorie_target:calories,protein_target:protein,net_carb_target:netCarbs,fiber_target:fiber,updated_at:new Date().toISOString()
    }).eq("id",log.id).select().single();
    if(lr.data)log=lr.data;
    settingsOpen=false;
    const panel=document.querySelector("#settingsPanel");
    if(panel)panel.style.display="none";
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
          <span class="pill">${round1(m.fiber_g||0)}g fiber</span>
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
    const plan=meals.filter(m=>m.source==="generated"&&!m.completed).reduce((a,m)=>{a.kcal+=Number(m.calories||0);a.p+=Number(m.protein_g||0);a.c+=Number(m.carbs_g||0);a.nc+=Number(m.net_carbs_g??m.carbs_g??0);a.fiber+=Number(m.fiber_g||0);a.f+=Number(m.fat_g||0);return a;},{kcal:0,p:0,c:0,nc:0,fiber:0,f:0});
    const remainingKcal=Math.max(0,Number(profile.calorie_target)-loggedNow.kcal);
    const remainingProtein=Math.max(0,Number(profile.protein_target)-loggedNow.p);
    const remainingNet=Math.max(0,Number(profile.net_carb_target??30)-loggedNow.nc);
    const recent7=history.slice(0,7);
    const avg=recent7.length?Math.round(recent7.reduce((a,x)=>a+Number(x.calories||0),0)/recent7.length):"—";
    const proteinHit=recent7.length?`${recent7.filter(x=>Number(x.protein_g)>=Number(x.protein_target)).length}/${recent7.length}`:"—";
    const latestWeight=weighins[0]?`${Number(weighins[0].weight_kg).toFixed(1)} kg`:"—";

    root.innerHTML=`
      <main class="wrap">
        <header class="top">
          <div class="brand">
            <div class="logo">CQ</div>
            <div><div class="brand-title">CutQuest</div><div class="tiny muted">${esc(user.email)}</div></div>
          </div>
          <div class="actions">
            <button id="settingsToggle" class="btn ghost icon-btn" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.3 4.9-1.7-1a6.9 6.9 0 0 0 0-.8l1.7-1-1.6-2.8-1.9.7a7 7 0 0 0-.7-.4L15.8 6h-3.2l-.3 2.1-.7.4-1.9-.7-1.6 2.8 1.7 1a6.9 6.9 0 0 0 0 .8l-1.7 1 1.6 2.8 1.9-.7.7.4.3 2.1h3.2l.3-2.1.7-.4 1.9.7 1.6-2.8Z"/></svg></button>
            <button id="signOut" class="btn ghost icon-btn" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h9v2H6v14h7v2H4V3Zm11.6 4.6L20 12l-4.4 4.4-1.4-1.4 2-2H9v-2h7.2l-2-2 1.4-1.4Z"/></svg></button>
          </div>
        </header>

        <section id="settingsPanel" class="settings card ${settingsOpen?"":"hidden"}" style="${settingsOpen?"":"display:none"}">
          <div><label>Calories</label><input id="calorieTarget" type="number" value="${Number(profile.calorie_target)}"></div>
          <div><label>Protein g</label><input id="proteinTarget" type="number" value="${Number(profile.protein_target)}"></div>
          <div><label>Net carbs g</label><input id="netCarbTarget" type="number" value="${Number(profile.net_carb_target??30)}"></div>
          <div><label>Fiber g</label><input id="fiberTarget" type="number" value="${Number(profile.fiber_target??30)}"></div>
          <div><label>Snack</label><input id="snackTime" type="time" value="${String(profile.eating_window_start||"16:00").slice(0,5)}"></div>
          <div><label>Dinner</label><input id="dinnerTime" type="time" value="${String(profile.eating_window_end||"17:45").slice(0,5)}"></div>
          <button id="saveSettings" class="btn primary">Save</button>
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
              <p class="muted">${Number(profile.calorie_target)} kcal · ${Number(profile.protein_target)}g protein · ${Number(profile.net_carb_target??30)}g net carbs · ${Number(profile.fiber_target??30)}g fiber</p>
            </div>
            <button id="generate" class="btn primary">Generate day</button>
          </div>

          <div class="grid3">
            <div class="card stat"><span>Calories logged</span><strong>${Math.round(Number(log.calories||0))}</strong></div>
            <div class="card stat"><span>Protein logged</span><strong>${Math.round(Number(log.protein_g||0))} g</strong></div>
            <div class="card stat"><span>Net carbs logged</span><strong>${round1(log.net_carbs_g??log.carbs_g)} g</strong></div>
            <div class="card stat"><span>Fiber logged</span><strong>${round1(log.fiber_g||0)} g</strong></div>
            <div class="card stat"><span>XP today</span><strong>${Number(log.xp_earned||0)}</strong></div>
          </div>

          <div class="progress-strip">
            <div>
              <div class="tiny"><b>REMAINING PLAN</b></div>
              <strong>${Math.round(plan.kcal)} kcal · ${Math.round(plan.p)}g P · ${round1(plan.nc)}g net C · ${round1(plan.fiber)}g fiber</strong>
            </div>
          </div>

          <div class="meals">${meals.filter(m=>m.source==="generated").map(mealCard).join("")}</div>
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
    document.querySelector("#settingsToggle").onclick=()=>{settingsOpen=!settingsOpen;render();};
    document.querySelector("#saveSettings")?.addEventListener("click",saveSettings);
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

  sb.auth.getSession()
    .then(async({data,error})=>{
      if(error)return showLogin(error.message);
      if(data.session?.user)await enter(data.session.user);
      else showLogin();
    })
    .catch(err=>showLogin(err?.message||"Could not restore your session."));

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
  }
})();
