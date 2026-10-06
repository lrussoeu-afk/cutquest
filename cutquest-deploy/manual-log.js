(() => {
  const today = () => new Date().toISOString().slice(0,10);
  let editingMealId = null;
  let editingRecipeId = null;
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
    .manual-header,.manual-row{display:grid;grid-template-columns:minmax(150px,1.5fr) repeat(6,.72fr) 76px;gap:8px;align-items:center}
    .manual-header{padding:0 0 8px;color:#758083;font-size:10px;text-transform:uppercase;letter-spacing:.07em}
    .manual-header span:not(:first-child),.manual-row>span{text-align:center;justify-self:center}
    .manual-row{padding:9px 0;border-bottom:1px solid #242a2c}
    .manual-row-actions{display:flex;gap:6px;justify-content:flex-end}
    .manual-row .btn{padding:7px 9px}.icon-delete,.icon-edit{width:34px;height:34px;padding:0!important;display:grid;place-items:center}.icon-delete{font-size:18px}.icon-edit svg{width:15px;height:15px;fill:currentColor}
    .recipe-grid{display:grid;grid-template-columns:minmax(220px,2fr) .7fr minmax(220px,1.5fr) auto;gap:8px;align-items:end}
    .recipe-grid select,.recipe-dialog select,.recipe-dialog textarea{width:100%;background:#0e1011;color:#fff;border:1px solid #303638;border-radius:9px;padding:11px;font:inherit}
    .recipe-preview{min-height:42px;display:flex;align-items:center;padding:0 12px;border:1px solid var(--line);border-radius:10px}
    .recipe-tools{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
    .recipe-modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:18px}
    .recipe-dialog{width:min(760px,100%);max-height:88vh;overflow:auto;background:#141718;border:1px solid #303638;border-radius:18px;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
    .recipe-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.recipe-editor-head h2{margin:2px 0 0;font-size:24px}
    .recipe-meta{display:grid;grid-template-columns:2fr .7fr;gap:10px;margin-bottom:14px}
    .recipe-ingredient{display:grid;grid-template-columns:minmax(220px,1.8fr) .6fr auto;gap:8px;align-items:end;margin-bottom:8px}
    .recipe-ingredient .btn{height:42px}
    .recipe-editor-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}
    .recipe-editor-preview{margin-top:12px;padding:12px;border-radius:10px;background:#101314;border:1px solid var(--line)}
    .recipe-notes{min-height:72px;resize:vertical}
    @media(max-width:720px){
      .manual-head{align-items:flex-start;flex-direction:column}
      .manual-grid{grid-template-columns:1fr 1fr 1fr}
      .manual-grid .manual-name{grid-column:1/-1}.manual-grid .record-check{grid-column:1/3}.manual-grid .icon-add{grid-column:3}
      .catalog-grid,.recipe-grid{grid-template-columns:1fr 1fr}
      .catalog-grid .catalog-food,.recipe-grid .recipe-select{grid-column:1/-1}
      .catalog-grid .catalog-preview,.recipe-grid .recipe-preview{grid-column:1/-1}
      .catalog-grid .btn,.recipe-grid .btn{grid-column:1/-1}
      .recipe-meta{grid-template-columns:1fr 1fr}
      .recipe-ingredient{grid-template-columns:1fr 90px auto}
      .recipe-dialog{padding:14px}
      .manual-header,.manual-row{grid-template-columns:1.4fr .7fr .7fr}
      .manual-header span:nth-child(4),.manual-header span:nth-child(5),.manual-header span:nth-child(6),.manual-header span:nth-child(7),.manual-header span:nth-child(8),
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
    const [{data:manuals},{data:catalog,error:catalogError},{data:userFoods,error:userFoodsError},{data:recipes,error:recipesError}] = await Promise.all([
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
        .order("name",{ascending:true}),
      client.from("user_recipes")
        .select("*")
        .eq("user_id",user.id)
        .eq("enabled",true)
        .order("name",{ascending:true})
    ]);
    if(catalogError || userFoodsError || recipesError) return null;
    const saved=(userFoods||[]).map(f=>({...f,personal:true,preference_score:10}));
    return {client,user,log,manuals:manuals||[],recipes:recipes||[],catalog:[...saved,...(catalog||[])]};
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

  function foodGroup(food){
    if(food.personal) return "Saved";
    if(food.category==="protein") return "Proteins";
    if(food.category==="vegetable" && Array.isArray(food.tags) && food.tags.includes("green")) return "Greens";
    if(food.category==="vegetable") return "Vegetables";
    if(food.category==="dairy") return "Dairy";
    if(food.category==="fat") return "Fats";
    if(food.category==="sauce") return "Sauces";
    return "Extras";
  }

  function catalogOptions(catalog,selectedId=""){
    const order=["Saved","Proteins","Greens","Vegetables","Dairy","Fats","Sauces","Extras"];
    const groups=new Map(order.map(x=>[x,[]]));
    for(const food of catalog){
      const group=foodGroup(food);
      if(!groups.has(group)) groups.set(group,[]);
      groups.get(group).push(food);
    }

    return order
      .filter(group=>groups.get(group)?.length)
      .map(group=>{
        const options=groups.get(group)
          .sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:"base"}))
          .map(f=>`<option value="${esc(f.id)}"${f.id===selectedId?" selected":""}>${esc(f.name)}${f.personal?" ★":""}</option>`)
          .join("");
        return `<optgroup label="${group}">${options}</optgroup>`;
      })
      .join("");
  }


  function ingredientSnapshot(food,grams){
    return {
      food_id:food.id,
      name:food.name,
      grams:round1(grams),
      calories_per_100g:Number(food.calories_per_100g||0),
      protein_g_per_100g:Number(food.protein_g_per_100g||0),
      carbs_g_per_100g:Number(food.carbs_g_per_100g||0),
      net_carbs_g_per_100g:Number(food.net_carbs_g_per_100g||0),
      fiber_g_per_100g:Number(food.fiber_g_per_100g||0),
      fat_g_per_100g:Number(food.fat_g_per_100g||0)
    };
  }

  function ingredientMacros(ingredient,grams=ingredient.grams){
    const factor=Number(grams||0)/100;
    return {
      calories:Number(ingredient.calories_per_100g||0)*factor,
      protein:Number(ingredient.protein_g_per_100g||0)*factor,
      carbs:Number(ingredient.carbs_g_per_100g||0)*factor,
      netCarbs:Number(ingredient.net_carbs_g_per_100g||0)*factor,
      fiber:Number(ingredient.fiber_g_per_100g||0)*factor,
      fat:Number(ingredient.fat_g_per_100g||0)*factor
    };
  }

  function recipeMacros(recipe,portions=1){
    const recipeServings=Math.max(.01,Number(recipe?.servings||1));
    const ratio=Number(portions||0)/recipeServings;
    return (Array.isArray(recipe?.ingredients)?recipe.ingredients:[]).reduce((sum,ingredient)=>{
      const m=ingredientMacros(ingredient,Number(ingredient.grams||0)*ratio);
      sum.calories+=m.calories;
      sum.protein+=m.protein;
      sum.carbs+=m.carbs;
      sum.netCarbs+=m.netCarbs;
      sum.fiber+=m.fiber;
      sum.fat+=m.fat;
      return sum;
    },{calories:0,protein:0,carbs:0,netCarbs:0,fiber:0,fat:0});
  }

  function selectedRecipe(ctx){
    const id=document.querySelector("#recipeSelect")?.value;
    return ctx.recipes.find(r=>r.id===id)||null;
  }

  function updateRecipePreview(ctx){
    const recipe=selectedRecipe(ctx);
    const portions=Number(document.querySelector("#recipePortions")?.value||0);
    const preview=document.querySelector("#recipePreview");
    const add=document.querySelector("#recipeAdd");
    const edit=document.querySelector("#recipeEdit");
    if(edit)edit.disabled=!recipe;
    if(!recipe||!portions||portions<=0){
      if(preview)preview.textContent=recipe?"Enter portions.":"Choose a recipe.";
      if(add)add.disabled=true;
      return;
    }
    const m=recipeMacros(recipe,portions);
    if(preview)preview.textContent=`${Math.round(m.calories)} kcal · ${round1(m.protein)}g P · ${round1(m.netCarbs)}g net C · ${round1(m.fiber)}g fiber · ${round1(m.fat)}g F`;
    if(add)add.disabled=false;
  }

  async function addRecipeToLog(ctx){
    const recipe=selectedRecipe(ctx);
    const portions=Number(document.querySelector("#recipePortions")?.value||0);
    const msg=document.querySelector("#recipeMsg");
    if(!recipe||!portions||portions<=0){
      if(msg)msg.textContent="Choose a recipe and portions.";
      return;
    }
    const ratio=portions/Math.max(.01,Number(recipe.servings||1));
    const m=recipeMacros(recipe,portions);
    const scaled=(recipe.ingredients||[]).map(i=>({
      slot:"recipe",
      food_id:i.food_id,
      name:i.name,
      grams:round1(Number(i.grams||0)*ratio)
    }));
    if(msg)msg.textContent="Logging…";
    const {error}=await ctx.client.from("meals").insert({
      user_id:ctx.user.id,
      daily_log_id:ctx.log.id,
      meal_type:"meal",
      planned_time:null,
      eaten_at:new Date().toISOString(),
      name:`${recipe.name} · ${round1(portions)} ${Number(portions)===1?"portion":"portions"}`,
      calories:round1(m.calories),
      protein_g:round1(m.protein),
      carbs_g:round1(m.carbs),
      net_carbs_g:round1(m.netCarbs),
      fiber_g:round1(m.fiber),
      fat_g:round1(m.fat),
      ingredients:scaled.map(i=>`${round1(i.grams)} g ${String(i.name).toLowerCase()}`),
      components:scaled,
      instructions:`Recipe: ${recipe.id}`,
      source:"manual",
      completed:true
    });
    if(error){
      if(msg)msg.textContent=error.message;
      return;
    }
    localStorage.setItem(`cutquest:lastrecipe:${recipe.id}`,String(portions));
    await recalc(ctx);
    if(window.CutQuestRefitPlan) await window.CutQuestRefitPlan();
    else location.reload();
  }

  function recipeIngredientRow(ctx,ingredient=null){
    const row=document.createElement("div");
    row.className="recipe-ingredient";
    const currentId=ingredient?.food_id||"";
    const fallback=currentId&&!ctx.catalog.some(f=>f.id===currentId)
      ? `<option value="${esc(currentId)}" selected>${esc(ingredient?.name||"Missing food")}</option>`
      : "";
    row.innerHTML=`
      <div>
        <label>Ingredient</label>
        <select class="recipe-food">
          <option value="">Select…</option>
          ${fallback}
          ${catalogOptions(ctx.catalog,currentId)}
        </select>
      </div>
      <div>
        <label>g</label>
        <input class="recipe-grams" type="number" min=".1" step=".1" value="${esc(ingredient?.grams??"")}">
      </div>
      <button type="button" class="btn ghost recipe-remove" aria-label="Remove ingredient" title="Remove ingredient">×</button>
    `;
    row.querySelector(".recipe-remove").onclick=()=>{
      row.remove();
      updateRecipeEditorPreview();
    };
    row.querySelector(".recipe-food").onchange=updateRecipeEditorPreview;
    row.querySelector(".recipe-grams").oninput=updateRecipeEditorPreview;
    return row;
  }

  function recipeDraftFromEditor(ctx){
    const name=document.querySelector("#recipeName")?.value.trim();
    const servings=Number(document.querySelector("#recipeServings")?.value||0);
    const notes=document.querySelector("#recipeNotes")?.value.trim()||null;
    const ingredients=[];
    for(const row of document.querySelectorAll("#recipeIngredients .recipe-ingredient")){
      const foodId=row.querySelector(".recipe-food")?.value;
      const grams=Number(row.querySelector(".recipe-grams")?.value||0);
      if(!foodId||!grams||grams<=0)continue;
      const food=ctx.catalog.find(f=>f.id===foodId);
      if(food) ingredients.push(ingredientSnapshot(food,grams));
      else {
        const old=(ctx.recipes.find(r=>r.id===editingRecipeId)?.ingredients||[]).find(i=>i.food_id===foodId);
        if(old)ingredients.push({...old,grams:round1(grams)});
      }
    }
    return {name,servings,notes,ingredients};
  }

  function updateRecipeEditorPreview(){
    const modal=document.querySelector("#recipeModal");
    const ctx=modal?._cutquestCtx;
    const preview=document.querySelector("#recipeEditorPreview");
    if(!ctx||!preview)return;
    const draft=recipeDraftFromEditor(ctx);
    if(!draft.servings||draft.servings<=0||!draft.ingredients.length){
      preview.textContent="Add ingredients and servings to calculate the recipe.";
      return;
    }
    const m=recipeMacros(draft,1);
    preview.textContent=`Per portion: ${Math.round(m.calories)} kcal · ${round1(m.protein)}g P · ${round1(m.netCarbs)}g net C · ${round1(m.fiber)}g fiber · ${round1(m.fat)}g F`;
  }

  function closeRecipeEditor(){
    document.querySelector("#recipeModal")?.remove();
    editingRecipeId=null;
  }

  function openRecipeEditor(ctx,recipe=null){
    closeRecipeEditor();
    editingRecipeId=recipe?.id||null;
    const modal=document.createElement("div");
    modal.id="recipeModal";
    modal.className="recipe-modal";
    modal._cutquestCtx=ctx;
    modal.innerHTML=`
      <div class="recipe-dialog" role="dialog" aria-modal="true" aria-label="${recipe?"Edit recipe":"New recipe"}">
        <div class="recipe-editor-head">
          <div><p class="eyebrow">RECIPE</p><h2>${recipe?"Edit recipe":"New recipe"}</h2></div>
          <button id="recipeClose" class="btn ghost" type="button">×</button>
        </div>
        <div class="recipe-meta">
          <div><label>Name</label><input id="recipeName" value="${esc(recipe?.name||"")}" placeholder="Recipe name"></div>
          <div><label>Portions in batch</label><input id="recipeServings" type="number" min=".25" step=".25" value="${esc(recipe?.servings||4)}"></div>
        </div>
        <div id="recipeIngredients"></div>
        <button id="recipeAddIngredient" type="button" class="btn ghost">+ Add ingredient</button>
        <div style="margin-top:12px"><label>Notes</label><textarea id="recipeNotes" class="recipe-notes" placeholder="Optional notes">${esc(recipe?.notes||"")}</textarea></div>
        <div id="recipeEditorPreview" class="recipe-editor-preview tiny muted"></div>
        <div id="recipeEditorMsg" class="tiny muted form-msg"></div>
        <div class="recipe-editor-actions">
          ${recipe?'<button id="recipeDelete" type="button" class="btn ghost danger">Delete recipe</button>':""}
          <button id="recipeCancel" type="button" class="btn ghost">Cancel</button>
          <button id="recipeSave" type="button" class="btn primary">Save recipe</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const holder=modal.querySelector("#recipeIngredients");
    const ingredients=Array.isArray(recipe?.ingredients)&&recipe.ingredients.length?recipe.ingredients:[null];
    ingredients.forEach(i=>holder.appendChild(recipeIngredientRow(ctx,i)));
    modal.querySelector("#recipeAddIngredient").onclick=()=>{
      holder.appendChild(recipeIngredientRow(ctx,null));
      holder.lastElementChild?.querySelector(".recipe-food")?.focus();
    };
    modal.querySelector("#recipeClose").onclick=closeRecipeEditor;
    modal.querySelector("#recipeCancel").onclick=closeRecipeEditor;
    modal.querySelector("#recipeSave").onclick=()=>saveRecipe(ctx);
    modal.querySelector("#recipeDelete")?.addEventListener("click",()=>deleteRecipe(ctx,recipe));
    modal.querySelector("#recipeName").oninput=updateRecipeEditorPreview;
    modal.querySelector("#recipeServings").oninput=updateRecipeEditorPreview;
    modal.onclick=e=>{if(e.target===modal)closeRecipeEditor();};
    updateRecipeEditorPreview();
  }

  async function saveRecipe(ctx){
    const msg=document.querySelector("#recipeEditorMsg");
    const draft=recipeDraftFromEditor(ctx);
    if(!draft.name){
      if(msg)msg.textContent="Give the recipe a name.";
      return;
    }
    if(!draft.servings||draft.servings<=0){
      if(msg)msg.textContent="Add the number of portions in the batch.";
      return;
    }
    if(!draft.ingredients.length){
      if(msg)msg.textContent="Add at least one ingredient.";
      return;
    }
    if(msg)msg.textContent="Saving…";
    const payload={
      user_id:ctx.user.id,
      name:draft.name,
      servings:draft.servings,
      ingredients:draft.ingredients,
      notes:draft.notes,
      enabled:true,
      updated_at:new Date().toISOString()
    };
    let result;
    if(editingRecipeId){
      result=await ctx.client.from("user_recipes").update(payload)
        .eq("id",editingRecipeId).eq("user_id",ctx.user.id).select().single();
    }else{
      result=await ctx.client.from("user_recipes").insert(payload).select().single();
    }
    if(result.error){
      if(msg)msg.textContent=result.error.message;
      return;
    }
    closeRecipeEditor();
    document.querySelector("#manualFoodBox")?.remove();
    await inject();
  }

  async function deleteRecipe(ctx,recipe){
    if(!recipe||!confirm(`Delete recipe "${recipe.name}"?`))return;
    const {error}=await ctx.client.from("user_recipes").delete()
      .eq("id",recipe.id).eq("user_id",ctx.user.id);
    if(error){
      const msg=document.querySelector("#recipeEditorMsg");
      if(msg)msg.textContent=error.message;
      return;
    }
    closeRecipeEditor();
    document.querySelector("#manualFoodBox")?.remove();
    await inject();
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

    if(editingMealId){
      const {error:updateError}=await ctx.client.from("meals").update({
        name:qty>0 ? name+" · "+round1(qty)+" g" : name,
        calories,
        protein_g:Number.isFinite(protein)?protein:0,
        carbs_g:Number.isFinite(totalCarbs)?totalCarbs:0,
        net_carbs_g:Number.isFinite(netCarbs)?netCarbs:0,
        fiber_g:Number.isFinite(fiber)?fiber:0,
        fat_g:Number.isFinite(fat)?fat:0,
        ingredients:[],
        completed:true
      })
      .eq("id",editingMealId)
      .eq("user_id",ctx.user.id);

      if(updateError){
        if(msg) msg.textContent=updateError.message;
        return;
      }

      editingMealId=null;
      await recalc(ctx);
      if(window.CutQuestRefitPlan) await window.CutQuestRefitPlan();
      else location.reload();
      return;
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
  function startEdit(m){
    editingMealId=m.id;
    const qtyFromComponent=Array.isArray(m.components)&&m.components.length
      ? Number(m.components[0]?.grams||0)
      : 0;
    const qtyMatch=String(m.name||"").match(/ · ([0-9]+(?:\.[0-9]+)?) g$/);
    const qty=qtyFromComponent || Number(qtyMatch?.[1]||0);
    const cleanName=String(m.name||"").replace(/ · [0-9]+(?:\.[0-9]+)? g$/,"");

    document.querySelector("#manualName").value=cleanName;
    document.querySelector("#manualQty").value=qty||"";
    document.querySelector("#manualCalories").value=round1(m.calories||0);
    document.querySelector("#manualProtein").value=round1(m.protein_g||0);
    document.querySelector("#manualCarbs").value=round1(m.carbs_g||0);
    document.querySelector("#manualNetCarbs").value=round1(m.net_carbs_g??m.carbs_g??0);
    document.querySelector("#manualFiber").value=round1(m.fiber_g||0);
    document.querySelector("#manualFat").value=round1(m.fat_g||0);
    document.querySelector("#manualRecord").checked=false;

    const add=document.querySelector("#manualAdd");
    if(add){
      add.textContent="✓";
      add.title="Save edit";
      add.setAttribute("aria-label","Save edit");
    }
    document.querySelector("#manualName")?.focus();
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
    return '<div class="manual-list"><div class="manual-header"><span>Food</span><span>kcal</span><span>Protein</span><span>Carbs</span><span>Net Carbs</span><span>Fiber</span><span>Fat</span><span></span></div>'+ctx.manuals.map(m=>`
      <div class="manual-row">
        <strong>${esc(m.name)}</strong>
        <span>${Math.round(Number(m.calories||0))}</span>
        <span>${Math.round(Number(m.protein_g||0))}</span>
        <span>${Math.round(Number(m.carbs_g||0))}</span>
        <span>${Math.round(Number(m.net_carbs_g??m.carbs_g??0))}</span>
        <span>${Math.round(Number(m.fiber_g||0))}</span>
        <span>${Math.round(Number(m.fat_g||0))}</span>
        <div class="manual-row-actions"><button class="btn ghost icon-edit" aria-label="Edit" title="Edit" data-manual-edit="${esc(m.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8Zm12.8-7.4 1.3-1.3a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0L14 7.2l2.8 2.7Z"/></svg></button><button class="btn ghost icon-delete" aria-label="Delete" title="Delete" data-manual-delete="${esc(m.id)}">×</button></div>
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
      <div class="recipe-grid">
        <div class="recipe-select">
          <label>Recipe</label>
          <select id="recipeSelect">
            <option value="">Select…</option>
            ${ctx.recipes.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Portions</label>
          <input id="recipePortions" type="number" min=".25" step=".25" value="1">
        </div>
        <div id="recipePreview" class="recipe-preview tiny muted">Choose a recipe.</div>
        <button id="recipeAdd" class="btn primary icon-add" aria-label="Log recipe" title="Log recipe" disabled>+</button>
      </div>
      <div class="recipe-tools">
        <button id="recipeNew" class="btn ghost" type="button">+ New recipe</button>
        <button id="recipeEdit" class="btn ghost" type="button" disabled>Edit recipe</button>
      </div>
      <div id="recipeMsg" class="tiny muted form-msg"></div>

      <div class="manual-divider"></div>

      <div class="catalog-grid">
        <div class="catalog-food">
          <label>Food</label>
          <select id="catalogFood">
            <option value="">Select…</option>
            ${catalogOptions(ctx.catalog)}
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
    box.querySelector("#recipeSelect").onchange = () => {
      const recipe=selectedRecipe(ctx);
      if(recipe){
        const last=Number(localStorage.getItem(`cutquest:lastrecipe:${recipe.id}`));
        box.querySelector("#recipePortions").value=last>0?last:1;
      }
      updateRecipePreview(ctx);
    };
    box.querySelector("#recipePortions").oninput = () => updateRecipePreview(ctx);
    box.querySelector("#recipeAdd").onclick = () => addRecipeToLog(ctx);
    box.querySelector("#recipeNew").onclick = () => openRecipeEditor(ctx,null);
    box.querySelector("#recipeEdit").onclick = () => {
      const recipe=selectedRecipe(ctx);
      if(recipe)openRecipeEditor(ctx,recipe);
    };
    box.querySelector("#catalogFood").onchange = () => updateCatalogPreview(ctx,true);
    box.querySelector("#catalogQty").oninput = () => updateCatalogPreview(ctx,false);
    box.querySelector("#catalogAdd").onclick = () => addCatalogFood(ctx);
    box.querySelector("#manualAdd").onclick = () => addFood(ctx);
    box.querySelectorAll("[data-manual-edit]").forEach(btn=>{
      const m = ctx.manuals.find(x=>x.id===btn.dataset.manualEdit);
      if(m) btn.onclick = () => startEdit(m);
    });
    box.querySelectorAll("[data-manual-delete]").forEach(btn=>{
      const m = ctx.manuals.find(x=>x.id===btn.dataset.manualDelete);
      if(m) btn.onclick = () => deleteFood(ctx,m.id,m.name);
    });
  }

  const observer = new MutationObserver(()=>inject().catch(()=>{}));
  observer.observe(document.querySelector("#root"),{childList:true,subtree:true});
  inject().catch(()=>{});
})();