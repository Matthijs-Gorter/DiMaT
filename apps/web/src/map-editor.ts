import {
  RESOURCES,
  computeRegions,
  cornerPoint,
  generateMap,
  key,
  neighbor,
  validateMap,
  type MapDefinition,
  type MapTileKind,
  type Resource,
  type TerrainStyle
} from '@dimat/maps';

const SVG_NS='http://www.w3.org/2000/svg';
type Brush=Resource|'desert'|'water'|'number'|'river'|'harbor';

function node<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text=''):HTMLElementTagNameMap[K]{
  const result=document.createElement(tag);if(className)result.className=className;if(text)result.textContent=text;return result;
}
function svgNode(tag:string):SVGElement{return document.createElementNS(SVG_NS,tag);}
function tileSideKey(q:number,r:number,side:number):string{
  const other=neighbor({q,r},side);return [key({q,r}),key(other)].sort().join('|');
}
function point(q:number,r:number,corner:number):[number,number]{
  const [x,y]=cornerPoint(q,r,corner);return [x*Math.sqrt(3),y];
}
function recomputeIslands(map:MapDefinition):void{
  const regions=computeRegions(map),counts=new Map<number,number>();
  map.tiles=map.tiles.map(tile=>{
    if(tile.kind==='water')return {...tile,islandId:0};
    const islandId=regions.get(key(tile))??0;counts.set(islandId,(counts.get(islandId)??0)+1);return {...tile,islandId};
  });
  map.islands=[...counts].sort(([a],[b])=>a-b).map(([id,tileCount])=>({id,tileCount,specialVP:0}));
}

export function mountMapEditor(root:HTMLElement,onBack:()=>void):void{
  let map:MapDefinition|undefined,statusMessage='',shareCode='';
  const page=node('main','map-editor'),heading=node('header','map-editor-heading'),back=node('button','gx-btn','Terug'),title=node('h1','','Map-editor');
  back.type='button';back.onclick=onBack;heading.append(back,title);page.append(heading);
  const generator=node('section','card map-generator'),style=node('select'),size=node('input'),players=node('select'),islands=node('input'),riverCount=node('select'),lakes=node('input'),seed=node('input'),balance=node('select');
  for(const name of ['standard','continent','archipelago','river','lakes','atoll','irregular','random'] as TerrainStyle[])style.append(new Option(name,name));
  for(const count of [3,4])players.append(new Option(`${count} spelers`,String(count)));
  size.type='number';size.min='19';size.max='150';size.value='19';size.setAttribute('aria-label','Landtegels');
  islands.type='number';islands.min='2';islands.max='20';islands.value='3';islands.setAttribute('aria-label','Aantal eilanden');
  riverCount.append(new Option('1 rivier','1'),new Option('2 rivieren','2'));
  lakes.type='number';lakes.min='1';lakes.max='10';lakes.value='2';lakes.setAttribute('aria-label','Aantal meren');
  seed.type='number';seed.value='1';seed.setAttribute('aria-label','Seed');
  balance.append(new Option('Willekeurige balans','random'),new Option('Eerlijke startplekken','balanced'));
  const generatorFields=node('div','map-editor-fields');
  for(const [labelText,field] of [['Stijl',style],['Spelers',players],['Landtegels',size],['Eilanden',islands],['Rivieren',riverCount],['Meren',lakes],['Seed',seed],['Balans',balance]] as const){
    const label=node('label','',labelText);label.append(field);generatorFields.append(label);
  }
  const generate=node('button','primary','Genereer map');generate.type='button';generator.append(generatorFields,generate);page.append(generator);

  const toolbar=node('section','card map-editor-tools'),brushSelect=node('select'),side=node('select'),number=node('select'),harborKind=node('select');
  const brushes:Brush[]=[...RESOURCES,'desert','water','number','river','harbor'];
  for(const item of brushes)brushSelect.append(new Option(item,item));
  for(let value=0;value<6;value++)side.append(new Option(`Zijde ${value}`,String(value)));
  for(const value of [2,3,4,5,6,8,9,10,11,12])number.append(new Option(String(value),String(value)));
  for(const item of ['generic',...RESOURCES])harborKind.append(new Option(item,item));
  const toolFields=node('div','map-editor-fields');
  for(const [labelText,field] of [['Penseel',brushSelect],['Zijde rivier/haven',side],['Nummer',number],['Haventype',harborKind]] as const){
    const label=node('label','',labelText);label.append(field);toolFields.append(label);
  }
  const mapName=node('input');mapName.placeholder='Mapnaam';mapName.maxLength=100;
  const nameLabel=node('label','','Mapnaam');nameLabel.append(mapName);toolFields.append(nameLabel);
  const validateStatus=node('div','map-validation'),save=node('button','primary','Opslaan en deelcode maken');save.type='button';save.disabled=true;
  const editorBoard=node('div','map-editor-board');
  toolbar.append(toolFields,validateStatus,save);page.append(toolbar,editorBoard);root.replaceChildren(page);

  function draw(){
    editorBoard.replaceChildren();
    if(!map)return;
    const svg=svgNode('svg'),vertices=map.tiles.flatMap(tile=>Array.from({length:6},(_,corner)=>point(tile.q,tile.r,corner)));
    const xs=vertices.map(([x])=>x),ys=vertices.map(([,y])=>y),minX=Math.min(...xs)-.5,minY=Math.min(...ys)-.5,width=Math.max(...xs)-Math.min(...xs)+1,height=Math.max(...ys)-Math.min(...ys)+1;
    svg.setAttribute('viewBox',`${minX} ${minY} ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Bewerkbare map');
    const colors:Record<string,string>={brick:'#b86550',lumber:'#4f8d59',wool:'#a7c77b',grain:'#e2bc55',ore:'#74828b',desert:'#d9b880',water:'#468fb5',gold:'#e9cf56',fog:'#99a5ad'};
    for(const tile of map.tiles){
      const polygon=svgNode('polygon'),corners=Array.from({length:6},(_,corner)=>point(tile.q,tile.r,corner));
      polygon.setAttribute('points',corners.map(([x,y])=>`${x},${y}`).join(' '));polygon.setAttribute('fill',colors[tile.kind]??'#888');polygon.setAttribute('stroke','#17232b');polygon.setAttribute('stroke-width','.08');
      polygon.dataset.tile=key(tile);polygon.addEventListener('click',()=>editTile(tile.q,tile.r));svg.append(polygon);
      if(tile.number!==null){const text=svgNode('text');text.setAttribute('x',String((corners[0]![0]+corners[3]![0])/2));text.setAttribute('y',String((corners[0]![1]+corners[3]![1])/2));text.setAttribute('text-anchor','middle');text.setAttribute('font-size','.48');text.setAttribute('fill','#111');text.setAttribute('pointer-events','none');text.textContent=String(tile.number);svg.append(text);}
    }
    const rivers=new Set(map.rivers.map(river=>tileSideKey(river.tile.q,river.tile.r,river.side)));
    for(const tile of map.tiles)if(tile.kind!=='water')for(let edge=0;edge<6;edge++){
      const [x1,y1]=point(tile.q,tile.r,edge),[x2,y2]=point(tile.q,tile.r,(edge+1)%6),edgeKey=tileSideKey(tile.q,tile.r,edge);
      const riverLine=svgNode('line');riverLine.setAttribute('x1',String(x1));riverLine.setAttribute('y1',String(y1));riverLine.setAttribute('x2',String(x2));riverLine.setAttribute('y2',String(y2));
      if(rivers.has(edgeKey)){riverLine.setAttribute('stroke','#b7edff');riverLine.setAttribute('stroke-width','.17');}else{riverLine.setAttribute('stroke','transparent');riverLine.setAttribute('stroke-width','.3');}
      riverLine.setAttribute('pointer-events','stroke');riverLine.addEventListener('click',()=>editEdge(tile.q,tile.r,edge));svg.append(riverLine);
      const harbor=map.harbors.find(item=>item.tile.q===tile.q&&item.tile.r===tile.r&&item.side===edge);
      if(harbor){const marker=svgNode('circle');marker.setAttribute('cx',String((x1+x2)/2));marker.setAttribute('cy',String((y1+y2)/2));marker.setAttribute('r','.14');marker.setAttribute('fill','#fff2a1');svg.append(marker);}
    }
    editorBoard.append(svg);
  }
  function updateValidation(){
    validateStatus.replaceChildren();
    if(!map){save.disabled=true;return;}
    const result=validateMap(map,{custom:map.style==='custom',balance:'random',players:Number(players.value)});
    const landCount=map.tiles.filter(tile=>tile.kind!=='water').length;
    validateStatus.append(node('p',result.ok?'map-valid':'map-invalid',`${landCount} landtegels · ${result.errors.length} fouten · ${result.warnings.length} waarschuwingen`));
    for(const error of result.errors)validateStatus.append(node('p','map-error',error));
    for(const warning of result.warnings)validateStatus.append(node('p','map-warning',warning));
    if(statusMessage)validateStatus.append(node('p','map-share-code',statusMessage));
    if(shareCode)validateStatus.append(node('strong','map-share-code',`Deelcode: ${shareCode}`));
    save.disabled=!result.ok;
  }
  function markCustom(){if(map){map.style='custom';map.meta.options={...(map.meta.options??{}),balance:'random'};map.name=mapName.value.trim()||'Custom map';shareCode='';statusMessage='';}}
  function editTile(q:number,r:number){
    if(!map)return;
    const tile=map.tiles.find(candidate=>candidate.q===q&&candidate.r===r);if(!tile)return;
    const selected=brushSelect.value as Brush;
    if(selected==='river'||selected==='harbor'){editEdge(q,r,Number(side.value));return;}
    if(selected==='number'){
      if(RESOURCES.includes(tile.kind as Resource)){tile.number=Number(number.value);tile.fixedNumber=true;}
    }else{
      const nextKind=selected as MapTileKind;
      const nextNumber=nextKind==='water'||nextKind==='desert'?null:(tile.number??5);
      map.tiles=map.tiles.map(candidate=>candidate.q===q&&candidate.r===r?{...candidate,kind:nextKind,number:nextNumber,fixedKind:true}:candidate);
    }
    markCustom();recomputeIslands(map);draw();updateValidation();
  }
  function editEdge(q:number,r:number,edge:number){
    if(!map)return;
    const selected=brushSelect.value,edgeKey=tileSideKey(q,r,edge);
    if(selected==='river'){
      const index=map.rivers.findIndex(river=>tileSideKey(river.tile.q,river.tile.r,river.side)===edgeKey);
      if(index>=0)map.rivers.splice(index,1);else map.rivers.push({tile:{q,r},side:edge as 0|1|2|3|4|5});
      markCustom();recomputeIslands(map);draw();updateValidation();
    }else if(selected==='harbor'){
      const index=map.harbors.findIndex(harbor=>harbor.tile.q===q&&harbor.tile.r===r&&harbor.side===edge);
      if(index>=0)map.harbors.splice(index,1);
      else{
        const kind=harborKind.value==='generic'?'generic':harborKind.value as Resource;
        const id=Math.max(-1,...map.harbors.map(harbor=>harbor.id))+1;
        map.harbors.push({id,kind,ratio:kind==='generic'?3:2,tile:{q,r},side:edge as 0|1|2|3|4|5});
      }
      markCustom();draw();updateValidation();
    }
  }
  generate.onclick=()=>{
    map=undefined;shareCode='';statusMessage='';
    try{
      const selectedStyle=style.value as TerrainStyle,playerCount:3|4=Number(players.value)===3?3:4,landTarget=Number(size.value),options={
        style:selectedStyle,seed:Number(seed.value),players:playerCount,balance:balance.value as 'random'|'balanced',
        ...(selectedStyle==='standard'?{}:{landTarget}),
        ...(selectedStyle==='archipelago'?{islandCount:Number(islands.value)}:{}),
        ...(selectedStyle==='river'?{riverCount:Number(riverCount.value)}:{}),
        ...(selectedStyle==='lakes'?{lakeCount:Number(lakes.value)}:{})
      };
      map=generateMap(options);mapName.value=map.name;statusMessage='';shareCode='';draw();updateValidation();
    }catch(error){statusMessage=error instanceof Error?error.message:'Mapgeneratie mislukt.';draw();updateValidation();}
  };
  mapName.addEventListener('input',()=>{if(map){map.name=mapName.value.trim()||'Custom map';markCustom();updateValidation();}});
  save.onclick=async()=>{
    if(!map)return;
    save.disabled=true;statusMessage='Map opslaan…';updateValidation();
    try{
      const response=await fetch('/api/maps',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(map)}),data=await response.json();
      if(!response.ok)throw new Error(data.message??'Map opslaan mislukt.');
      shareCode=data.shareCode;statusMessage='Map opgeslagen.';updateValidation();
    }catch(error){statusMessage=error instanceof Error?error.message:'Map opslaan mislukt.';updateValidation();}
  };
  generate.click();
}
