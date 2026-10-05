(() => {
  const today = () => new Date().toISOString().slice(0,10);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));

  const style = document.createElement("style");
  style.textContent = `
    .manual-box{margin:12px 0 14px}
    .manual-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:12px}
    .manual-grid{display:grid;grid-template-columns:minmax(170px,1.7fr) repeat(7,.72fr) auto auto;gap:8px;align-items:end}
    .catalog-grid{display:grid;grid-template-columns:minmax(220px,2fr) .7fr minmax(220px,1.5fr) auto;gap:8px;align-items:end}
    .catalog-grid select{width:100%;background:#0e1011;color:#fff;border:1px solid #303638;border-radius:9px;padding:11px;font:inherit}
    .catalog-preview{min-height:42px;display:flex;align-items:center;padding:0 12px;border:1px solid var(--line);border-radius:10px}
    .manual-divider{height:1px;background:var(--line);margin:16px 0}
    .record-check{display:flex;gap:7px;align-items:center;margin:0;padding:0 4px 10px;color:#aeb6b8;font-size:11px;white-space:nowrap}.record-check input{width:auto}.icon-add{min-width:42px;font-size:20px;line-height:1}.form-msg{min-height:12px;margin-top:6px}.manual-list{margin-top:12px;border-top:1px solid var(--line)}
    .manual-row{display:grid;grid-template-columns:minmax(150px,1.5fr) repeat(6,.72fr) auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #242a2c}
    .manual-row .btn{padding:7px 9px}.icon-delete{width:34px;height:34px;padding:0!important;font-size:18px;display:grid;place-items:center}
    @media(max-width:720px){
      .manual-head{align-items:flex-start;flex-direction:column}
      .manual-grid{grid-template-columns:1fr 1fr 1fr}
      .manual-grid .manual-name{grid-column:1/-1}.manual-grid .record-check{grid-column:1/3}.manual-grid .icon-add{grid-column:3}
      .catalog-grid{grid-template-columns:1fr 1fr}
      .catalog-grid .catalog-food{grid-column:1/-1}
      .catalog-grid .catalog-preview{grid-column:1/-1}
      .catalog-grid .btn{grid-column:1/-1}
      .manual-row{grid-template-columns:1.4fr .7fr .7fr}
      .manual-row span:nth-child(4),.manual-row span:nth-child(5),.manual-row span:nth-child(6),.manual-row span:nth-child(7){display:none}
    }
  `;
  document.head.appendChild(style);

  function sb(){
    return window.CutQuestSB || null;
  }

  async function sessionUser(){
    const client = sb();
    if(!client) return null;
    const {data} = await client.auth.getSession();
    return data.session?.user || null;
  }

  async function getTodayContext(){
    const client = sb();
    const user = await sessionUser();
    if(!client || !user) return null;
    const {data:log,error} = await client.from("daily_logs")
      .select("*")
      .eq("user_id",user.id)
      .eq("log_date",today())
      .maybeSingle();
    if(error || !log) return null;
    const [{data:manuals},{data:catalog,error:catalogError},{data:userFoods,error:userFoodsError}] = await Promise.all([
      client.from("meals")
        .select("*")
        .eq("daily_log_id",log.id)
        .eq("source","manual")
        .order("created_at",{ascending:false}),
      client.from("food_items")
        .select("*")
        .eq("enabled",true)
        .order("preference_score",{ascending:false})
        .order("name",{ascending:true}),
      client.from("user_food_items")
        .select("*")
        .eq("user_id",user.id)
        .eq("enabled",true)
        .order("name",{ascending:true})
    ]);
    if(catalogError || userFoodsError) return null;
    const saved=(userFoods||[]).map(f=>({...f,personal:true,preference_score:10}));
    return {client,user,log,manuals:manuals||[],catalog:[...saved,...(catalog||[])]};
  }

  async function recalc(ctx){
    const {client,user,log} = ctx;
    const {data:all,error} = await client.from("meals")
      .select("*")
      .eq("daily_log_id",log.id);
    if(error) throw error;
    const meals = all || [];
    const eaten = meals.filter(x=>x.completed);
    const sum = eaten.reduce((a,m)=>{
      a.kcal += Number(m.calories||0);
      a.p += Number(m.protein_g||0);
      a.c += Number(m.carbs_g||0);
      a.nc += Number(m.net_carbs_g??m.carbs_g??0);
      a.fiber += Number(m.fiber_g||0);
      a.f += Number(m.fat_g||0);
      return a;
    },{kcal:0,p:0,c:0,nc:0,fiber:0,f:0});

    const generated = meals.filter(x=>x.source==="generated");
    const missionComplete = generated.length>0 && generated.every(x=>x.completed);
    const loggedGenerated = generated.filter(x=>x.completed).length;
    const xp = loggedGenerated*25 + (missionComplete?50:0);

    const {error:updateError} = await client.from("daily_logs").update({
      calories:sum.kcal,
      protein_g:sum.p,
      carbs_g:sum.c,
      net_carbs_g:sum.nc,
      fiber_g:sum.fiber,
      fat_g:sum.f,
      completed:missionComplete,
      xp_earned:xp,
      updated_at:new Date().toISOString()
    }).eq("id",log.id).eq("user_id",user.id);
    if(updateError) throw updateError;
  }

  const round1 = n => Math.round(Number(n||0)*10)/10;

  function catalogMacros(food,grams){
    const factor=Number(grams||0)/100;
    return {
      calories:Number(food.calories_per_100g||0)*factor,
      protein:Number(food.protein_g_per_100g||0)*factor,
      carbs:Number(food.carbs_g_per_100g||0)*factor,
      netCarbs:Number(food.net_carbs_g_per_100g||0)*factor,
      fiber:Number(food.fiber_g_per_100g||0)*factor,
      fat:Number(food.fat_g_per_100g||0)*factor
    };
  }

  function rememberedQuantity(food){
    const stored=Number(localStorage.getItem(`cutquest:lastqty:${food.id}`));
    return stored>0 ? stored : Number(food.default_portion_g||100);
  }

  function selectedCatalogFood(ctx){
    const id=document.querySelector("#catalogFood")?.value;
    return ctx.catalog.find(f=>f.id===id)||null;
  }

  function updateCatalogPreview(ctx,resetQuantity=false){
    const food=selectedCatalogFood(ctx);
    const qty=document.querySelector("#catalogQty");
    const preview=document.querySelector("#catalogPreview");
    const button=document.querySelector("#catalogAdd");
    if(!food){
      if(preview)preview.textContent="";
      if(button)button.disabled=true;
      return;
    }
    if(resetQuantity&&qty)qty.value=rememberedQuantity(food);
    const grams=Number(qty?.value||0);
    if(!grams||grams<=0){
      if(preview)preview.textContent="Enter a quantity.";
      if(button)button.disabled=true;
      return;
    }
    const m=catalogMacros(food,grams);
    if(preview)preview.textContent=`${Math.round(m.calories)} kcal · ${round1(m.protein)}g P · ${round1(m.netCarbs)}g net C · ${round1(m.fiber)}g fiber · ${round1(m.fat)}g F`;
    if(button)button.disabled=false;
  }

  async function addCatalogFood(ctx){
    const food=selectedCatalogFood(ctx);
    const grams=Number(document.querySelector("#catalogQty")?.value||0);
    const msg=document.querySelector("#catalogMsg");
    if(!food||!grams||grams<=0){
      if(msg)msg.textContent="Choose a food and quantity.";
      return;
    }

    const m=catalogMacros(food,grams);
    if(msg)msg.textContent="Logging…";
    const {error}=await ctx.client.from("meals").insert({
      user_id:ctx.user.id,
      daily_log_id:ctx.log.id,
      meal_type:"meal",
      planned_time:null,
      eaten_at:new Date().toISOString(),
      name:`${food.name} · ${round1(grams)} g`,
      calories:round1(m.calories),
      protein_g:round1(m.protein),
      carbs_g:round1(m.carbs),
      net_carbs_g:round1(m.netCarbs),
      fiber_g:round1(m.fiber),
      fat_g:round1(m.fat),
      ingredients:[`${round1(grams)} g ${food.name.toLowerCase()}`],
      components:[{slot:"logged",food_id:food.id,name:food.name,grams:round1(grams)}],
      source:"manual",
      completed:true
    });

    if(error){
      if(msg)msg.textContent=error.message;
      return;
    }

    localStorage.setItem(`cutquest:lastqty:${food.id}`,String(grams));
    await recalc(ctx);
    if(window.CutQuestRefitPlan) await window.CutQuestRefitPlan();
    else location.reload();
  }

  async function addFood(ctx){
    const name = document.querySelector("#manualName")?.value.trim();
    const qty = Number(document.querySelector("#manualQty")?.value || 0);
    const caloriesRaw = document.querySelector("#manualCalories")?.value ?? "";
    const proteinRaw = document.querySelector("#manualProtein")?.value ?? "";
    const carbsRaw = document.querySelector("#manualCarbs")?.value ?? "";
    const netRaw = document.querySelector("#manualNetCarbs")?.value ?? "";
    const fiberRaw = document.querySelector("#manualFiber")?.value ?? "";
    const fatRaw = document.querySelector("#manualFat")?.value ?? "";
    const calories = Number(caloriesRaw);
    const protein = Number(proteinRaw || 0);
    const totalCarbs = Number(carbsRaw || 0);
    const netCarbs = Number(netRaw || 0);
    const fiber = Number(fiberRaw || 0);
    const fat = Number(fatRaw || 0);
    const record = document.querySelector("#manualRecord")?.checked ?? true;
    const msg = document.querySelector("#manualMsg");

    if(!name || !Number.isFinite(calories) || calories < 0){
      if(msg) msg.textContent = "Add a name and calories.";
      return;
    }

    if(record){
      const complete = qty>0 && [caloriesRaw,proteinRaw,carbsRaw,netRaw,fiberRaw,fatRaw].every(v=>String(v).trim()!=="");
      if(!complete){
        if(msg) msg.textContent = "To save this food, add quantity and all macros.";
        return;
      }
    }

    if(msg) msg.textContent = "Logging…";

    if(record){
      const per100=100/qty;
      const {error:saveError}=await ctx.client.from("user_food_items").upsert({
        user_id:ctx.user.id,
        name,
        calories_per_100g:round1(calories*per100),
        protein_g_per_100g:round1(protein*per100),
        carbs_g_per_100g:round1(totalCarbs*per100),
        net_carbs_g_per_100g:round1(netCarbs*per100),
        fiber_g_per_100g:round1(fiber*per100),
        fat_g_per_100g:round1(fat*per100),
        default_portion_g:qty,
        enabled:true,
        updated_at:new Date().toISOString()
      },{onConflict:"user_id,name"});
      if(saveError){
        if(msg) msg.textContent = saveError.message;
        return;
      }
    }

    const {error} = await ctx.client.from("meals").insert({
      user_id:ctx.user.id,
      daily_log_id:ctx.log.id,
      meal_type:"meal",
      planned_time:null,
      eaten_at:new Date().toISOString(),
      name:qty>0 ? name+" · "+round1(qty)+" g" : name,
      calories,
      protein_g:Number.isFinite(protein)?protein:0,
      carbs_g:Number.isFinite(totalCarbs)?totalCarbs:0,
      net_carbs_g:Number.isFinite(netCarbs)?netCarbs:0,
      fiber_g:Number.isFinite(fiber)?fiber:0,
      fat_g:Number.isFinite(fat)?fat:0,
      ingredients:[],
      source:"manual",
      completed:true
    });

    if(error){
      if(msg) msg.textContent = error.message;
      return;
    }

    await recalc(ctx);
    if(window.CutQuestRefitPlan) await window.CutQuestRefitPlan();
    else location.reload();
  }
  async function deleteFood(ctx,id,name){
    if(!confirm(`Delete "${name}" from today's log?`)) return;
    const {error} = await ctx.client.from("meals")
      .delete()
      .eq("id",id)
      .eq("user_id",ctx.user.id)
      .eq("source","manual");
    if(error){
      alert(error.message);
      return;
    }
    await recalc(ctx);
    if(window.CutQuestRefitPlan) await window.CutQuestRefitPlan();
    else location.reload();
  }

  function decorateManualCards(ctx){
    for(const m of ctx.manuals){
      const toggle = document.querySelector(`[data-toggle="${CSS.escape(m.id)}"]`);
      const card = toggle?.closest(".meal");
      if(!card) continue;
      const eyebrow = card.querySelector(".eyebrow");
      if(eyebrow) eyebrow.textContent = "MANUAL LOG";
      const ul = card.querySelector("ul");
      if(ul) ul.style.display = "none";
      const reroll = card.querySelector("[data-reroll]");
      if(reroll){
        reroll.textContent = "Delete entry";
        reroll.disabled = false;
        reroll.removeAttribute("data-reroll");
        reroll.classList.add("danger");
        reroll.onclick = () => deleteFood(ctx,m.id,m.name);
      }
      if(toggle){
        toggle.textContent = "✓ Logged";
        toggle.disabled = true;
      }
    }
  }

  function manualRows(ctx){
    if(!ctx.manuals.length) return '';
    return '<div class="manual-list">'+ctx.manuals.map(m=>`
      <div class="manual-row">
        <strong>${esc(m.name)}</strong>
        <span>${Math.round(Number(m.calories||0))}</span>
        <span>${Math.round(Number(m.protein_g||0))}</span>
        <span>${Math.round(Number(m.carbs_g||0))}</span>
        <span>${Math.round(Number(m.net_carbs_g??m.carbs_g??0))}</span>
        <span>${Math.round(Number(m.fiber_g||0))}</span>
        <span>${Math.round(Number(m.fat_g||0))}</span>
        <button class="btn ghost icon-delete" aria-label="Delete" title="Delete" data-manual-delete="${esc(m.id)}">×</button>
      </div>`).join("")+'</div>';
  }

  async function inject(){
    if(document.querySelector("#manualFoodBox")) return;
    const todayPanel = document.querySelector("#today.panel.on, #today");
    const mealGrid = todayPanel?.querySelector(".meals");
    if(!todayPanel || !mealGrid || !sb()) return;

    const ctx = await getTodayContext();
    if(!ctx || document.querySelector("#manualFoodBox")) return;

    const box = document.createElement("section");
    box.id = "manualFoodBox";
    box.className = "card manual-box";
    box.innerHTML = `
      <div class="catalog-grid">
        <div class="catalog-food">
          <label>Food</label>
          <select id="catalogFood">
            <option value="">Select…</option>
            ${ctx.catalog.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}${f.personal?" ★":""}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>g</label>
          <input id="catalogQty" type="number" min="1" step="1" placeholder="250">
        </div>
        <div id="catalogPreview" class="catalog-preview tiny muted"></div>
        <button id="catalogAdd" class="btn primary icon-add" aria-label="Add" title="Add" disabled>+</button>
      </div>
      <div id="catalogMsg" class="tiny muted form-msg"></div>

      <div class="manual-divider"></div>

      <div class="manual-grid custom-grid">
        <div class="manual-name"><label>Custom</label><input id="manualName" placeholder="Food"></div>
        <div><label>g</label><input id="manualQty" type="number" min="1" step="1" placeholder="100"></div>
        <div><label>kcal</label><input id="manualCalories" type="number" min="0" step="1"></div>
        <div><label>Protein</label><input id="manualProtein" type="number" min="0" step=".1"></div>
        <div><label>Carbs</label><input id="manualCarbs" type="number" min="0" step=".1"></div>
        <div><label>Net Carbs</label><input id="manualNetCarbs" type="number" min="0" step=".1"></div>
        <div><label>Fiber</label><input id="manualFiber" type="number" min="0" step=".1"></div>
        <div><label>Fat</label><input id="manualFat" type="number" min="0" step=".1"></div>
        <label class="record-check" title="Keep this food in your list">
          <input id="manualRecord" type="checkbox" checked>
          <span>Record</span>
        </label>
        <button id="manualAdd" class="btn primary icon-add" aria-label="Add" title="Add">+</button>
      </div>
      <div id="manualMsg" class="tiny muted form-msg"></div>
      ${manualRows(ctx)}
    `;

    mealGrid.parentNode.insertBefore(box,mealGrid);
    box.querySelector("#catalogFood").onchange = () => updateCatalogPreview(ctx,true);
    box.querySelector("#catalogQty").oninput = () => updateCatalogPreview(ctx,false);
    box.querySelector("#catalogAdd").onclick = () => addCatalogFood(ctx);
    box.querySelector("#manualAdd").onclick = () => addFood(ctx);
    box.querySelectorAll("[data-manual-delete]").forEach(btn=>{
      const m = ctx.manuals.find(x=>x.id===btn.dataset.manualDelete);
      if(m) btn.onclick = () => deleteFood(ctx,m.id,m.name);
    });
  }

  const observer = new MutationObserver(()=>inject().catch(()=>{}));
  observer.observe(document.querySelector("#root"),{childList:true,subtree:true});
  inject().catch(()=>{});
})();