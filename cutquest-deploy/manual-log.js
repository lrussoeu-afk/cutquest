(() => {
  const today = () => new Date().toISOString().slice(0,10);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));

  const style = document.createElement("style");
  style.textContent = `
    .manual-box{margin:12px 0 14px}
    .manual-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:12px}
    .manual-grid{display:grid;grid-template-columns:2fr repeat(5,.7fr) auto;gap:8px;align-items:end}
    .manual-list{margin-top:12px;border-top:1px solid var(--line)}
    .manual-row{display:grid;grid-template-columns:1.5fr repeat(5,.6fr) auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #242a2c}
    .manual-row .btn{padding:7px 9px}
    @media(max-width:720px){
      .manual-head{align-items:flex-start;flex-direction:column}
      .manual-grid{grid-template-columns:1fr 1fr}
      .manual-grid .manual-name{grid-column:1/-1}
      .manual-grid .btn{grid-column:1/-1}
      .manual-row{grid-template-columns:1.4fr .7fr .7fr}
      .manual-row span:nth-child(5),.manual-row span:nth-child(6){display:none}
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
    const {data:manuals} = await client.from("meals")
      .select("*")
      .eq("daily_log_id",log.id)
      .eq("source","manual")
      .order("created_at",{ascending:false});
    return {client,user,log,manuals:manuals||[]};
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
      a.f += Number(m.fat_g||0);
      return a;
    },{kcal:0,p:0,c:0,nc:0,f:0});

    const generated = meals.filter(x=>x.source==="generated");
    const missionComplete = generated.length>0 && generated.every(x=>x.completed);
    const loggedGenerated = generated.filter(x=>x.completed).length;
    const xp = loggedGenerated*25 + (missionComplete?50:0);

    const {error:updateError} = await client.from("daily_logs").update({
      calories:sum.kcal,
      protein_g:sum.p,
      carbs_g:sum.c,
      net_carbs_g:sum.nc,
      fat_g:sum.f,
      completed:missionComplete,
      xp_earned:xp,
      updated_at:new Date().toISOString()
    }).eq("id",log.id).eq("user_id",user.id);
    if(updateError) throw updateError;
  }

  async function addFood(ctx){
    const name = document.querySelector("#manualName")?.value.trim();
    const calories = Number(document.querySelector("#manualCalories")?.value);
    const protein = Number(document.querySelector("#manualProtein")?.value || 0);
    const netRaw = document.querySelector("#manualNetCarbs")?.value ?? "";
    const totalRaw = document.querySelector("#manualTotalCarbs")?.value ?? "";
    const netCarbs = Number(netRaw === "" ? (totalRaw || 0) : netRaw);
    const totalCarbs = Math.max(netCarbs, Number(totalRaw === "" ? netCarbs : totalRaw));
    const fat = Number(document.querySelector("#manualFat")?.value || 0);
    const msg = document.querySelector("#manualMsg");

    if(!name || !Number.isFinite(calories) || calories < 0){
      if(msg) msg.textContent = "Add a food name and valid calories.";
      return;
    }

    if(msg) msg.textContent = "Logging…";
    const {error} = await ctx.client.from("meals").insert({
      user_id:ctx.user.id,
      daily_log_id:ctx.log.id,
      meal_type:"meal",
      planned_time:null,
      eaten_at:new Date().toISOString(),
      name,
      calories,
      protein_g:Number.isFinite(protein)?protein:0,
      carbs_g:Number.isFinite(totalCarbs)?totalCarbs:0,
      net_carbs_g:Number.isFinite(netCarbs)?netCarbs:0,
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
    if(!ctx.manuals.length) return '<p class="tiny muted" style="margin:10px 0 0">Nothing logged manually yet.</p>';
    return '<div class="manual-list">'+ctx.manuals.map(m=>`
      <div class="manual-row">
        <strong>${esc(m.name)}</strong>
        <span>${Math.round(Number(m.calories||0))} kcal</span>
        <span>${Math.round(Number(m.protein_g||0))}g P</span>
        <span>${Math.round(Number(m.net_carbs_g??m.carbs_g??0))}g net C</span>
        <span>${Math.round(Number(m.carbs_g||0))}g total C</span>
        <span>${Math.round(Number(m.fat_g||0))}g F</span>
        <button class="btn ghost" data-manual-delete="${esc(m.id)}">Delete</button>
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
      <div class="manual-head">
        <div>
          <p class="eyebrow">MANUAL FOOD LOG</p>
          <strong>Add anything you actually ate</strong>
        </div>
        <span class="tiny muted">Net carbs are the keto number. On EU labels, “carbs” is usually already close to net carbs; total carbs is optional.</span>
      </div>
      <div class="manual-grid">
        <div class="manual-name"><label>Food / meal</label><input id="manualName" placeholder="e.g. 2 eggs + butter"></div>
        <div><label>kcal</label><input id="manualCalories" type="number" min="0" step="1" placeholder="250"></div>
        <div><label>Protein</label><input id="manualProtein" type="number" min="0" step=".1" placeholder="20"></div>
        <div><label>Net carbs</label><input id="manualNetCarbs" type="number" min="0" step=".1" placeholder="3"></div>
        <div><label>Total carbs</label><input id="manualTotalCarbs" type="number" min="0" step=".1" placeholder="optional"></div>
        <div><label>Fat</label><input id="manualFat" type="number" min="0" step=".1" placeholder="15"></div>
        <button id="manualAdd" class="btn primary">+ Log food</button>
      </div>
      <div id="manualMsg" class="tiny muted" style="margin-top:8px"></div>
      ${manualRows(ctx)}
    `;

    mealGrid.parentNode.insertBefore(box,mealGrid);
    box.querySelector("#manualAdd").onclick = () => addFood(ctx);
    box.querySelectorAll("[data-manual-delete]").forEach(btn=>{
      const m = ctx.manuals.find(x=>x.id===btn.dataset.manualDelete);
      if(m) btn.onclick = () => deleteFood(ctx,m.id,m.name);
    });
    decorateManualCards(ctx);
  }

  const observer = new MutationObserver(()=>inject().catch(()=>{}));
  observer.observe(document.querySelector("#root"),{childList:true,subtree:true});
  inject().catch(()=>{});
})();