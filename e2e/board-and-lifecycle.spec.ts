import { expect, test, type Browser, type Page } from '@playwright/test';

async function createTwoHumansAndBot(browser:Browser){
  const hostContext=await browser.newContext();const guestContext=await browser.newContext();
  const host=await hostContext.newPage();const guest=await guestContext.newPage();
  await host.route('**/api/rooms',async route=>{const body=route.request().postDataJSON() as Record<string,unknown>;await route.continue({postData:JSON.stringify({...body,seed:6})});});
  await host.goto('/');await host.getByPlaceholder('Je naam').fill('Host');await host.getByRole('button',{name:'Nieuwe kamer (1 bot)'}).click();
  await expect(host).toHaveURL(/\/play\/[a-f0-9]+/);const invite=host.url();
  await guest.goto(invite);await guest.getByPlaceholder('Je naam').fill('Guest');await guest.getByRole('button',{name:'Deelnemen aan kamer'}).click();
  await expect(host.getByText('Guest')).toBeVisible();
  return {hostContext,guestContext,host,guest};
}

async function clickBoardTarget(page:Page,selector:string){
  const target=page.locator(selector).first();await expect(target).toBeVisible();const bounds=await target.boundingBox();if(!bounds)throw new Error(`Board target is not visible: ${selector}`);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
}

test('lobby does not expose action submission before the server starts the game',async({browser})=>{
  const {host,hostContext,guestContext}=await createTwoHumansAndBot(browser);
  await expect(host.locator('.actions')).toBeHidden();
  await host.evaluate(()=>{(window as Window&{dimatSend?:WebSocket}).dimatSend?.send(JSON.stringify({type:'action',sequence:1,action:{type:'placeSettlement',playerId:'p0',vertex:0}}));});
  await expect(host.getByText(/GAME_NOT_STARTED/)).toBeVisible();
  await guestContext.close();await hostContext.close();
});

test('setup roads have direct legal edge hit targets on the board',async({browser})=>{
  const {host,hostContext,guest,guestContext}=await createTwoHumansAndBot(browser);
  await host.setViewportSize({width:1024,height:768});
  await host.getByRole('button',{name:'Start spel'}).click();
  await expect(host.locator('.terrain-art')).toHaveCount(19);
  const maskGeometry=await host.locator('.terrain-art').evaluateAll(images=>images.map(image=>{const mask=image.ownerDocument.getElementById(image.getAttribute('clip-path')!.slice(5,-1))?.querySelector('polygon')!;const bounds=mask.getBBox();return {transform:mask.getAttribute('transform'),width:image.getAttribute('width'),height:image.getAttribute('height'),maskWidth:bounds.width,maskHeight:bounds.height};}));
  expect(maskGeometry).toHaveLength(19);
  for(const geometry of maskGeometry){expect(geometry.transform).toBeNull();expect(geometry.width).toBe('4');expect(Number(geometry.height)).toBeCloseTo(2*Math.sqrt(3),5);expect(geometry.maskWidth).toBeCloseTo(4,5);expect(geometry.maskHeight).toBeCloseTo(2*Math.sqrt(3),5);}
  const tileStyle=await host.locator('.hex').first().evaluate(tile=>({gap:getComputedStyle(tile).strokeWidth,label:getComputedStyle(tile.ownerDocument.querySelector('.number-label')!).fontSize}));
  expect(tileStyle.gap).toBe('5px');
  expect(Number.parseFloat(tileStyle.label)).toBeCloseTo(.34,5);
  await expect(host.locator('.number-token').first()).toHaveAttribute('r','.6');
  await expect(host.locator('.beach-rim')).toHaveCount(0);
  await expect(host.locator('.harbor-marker')).toHaveCount(9);
  await expect(host.locator('.harbor-marker').first()).toHaveAttribute('r','0.45');
  const harborGeometry=await host.locator('.harbor').evaluateAll(groups=>groups.map(group=>{
    const connectors=[...group.querySelectorAll<SVGLineElement>('.harbor-connector')],marker=group.querySelector<SVGCircleElement>('.harbor-marker')!;
    return {edge:group.getAttribute('data-edge'),connectors:connectors.map(connector=>({vertex:connector.dataset.vertex,start:[connector.x1.baseVal.value,connector.y1.baseVal.value],endpoint:[connector.x2.baseVal.value,connector.y2.baseVal.value]})),center:[marker.cx.baseVal.value,marker.cy.baseVal.value],radius:marker.r.baseVal.value};
  }));
  expect(harborGeometry).toHaveLength(9);
  const legalVertices=await host.locator('.spot.legal').evaluateAll(spots=>spots.map(spot=>{const circle=spot as SVGCircleElement;return [circle.cx.baseVal.value,circle.cy.baseVal.value];}));
  for(const harbor of harborGeometry){expect(harbor.edge).not.toBeNull();expect(harbor.connectors).toHaveLength(2);expect(harbor.radius).toBeCloseTo(.45,5);const endpoints=new Set<string>();for(const connector of harbor.connectors){expect(connector.vertex).not.toBeNull();expect(legalVertices.some(([vertexX,vertexY])=>Math.abs(vertexX!-connector.start[0]!)<1e-4&&Math.abs(vertexY!-connector.start[1]!)<1e-4)).toBe(true);expect(Math.abs(Math.hypot(connector.endpoint[0]!-harbor.center[0]!,connector.endpoint[1]!-harbor.center[1]!)-harbor.radius)).toBeLessThan(1e-4);endpoints.add(connector.endpoint.join(','));}expect(endpoints.size).toBe(2);}
  const tileImages=await host.locator('.terrain-art').evaluateAll(images=>images.map(image=>({kind:image.getAttribute('data-kind'),path:image.getAttribute('href')})));
  const tileAssetPrefixes:Record<string,string>={brick:'spring-brick-',lumber:'spring-wood-',wool:'spring-sheep-',grain:'spring-wheat-',ore:'spring-ore-',desert:'spring-desert_'};
  for(const image of tileImages){expect(image.path).toMatch(new RegExp(`^/tiles/${tileAssetPrefixes[image.kind??'']}.*\\.jpg$`));}
  const assetResponses=await host.evaluate(async paths=>Promise.all([...new Set(paths)].map(async path=>(await fetch(path)).ok)),tileImages.map(image=>image.path!));
  expect(assetResponses.every(Boolean)).toBe(true);
  await expect(host.locator('.spot.legal')).toHaveCount(54,{timeout:5000});
  await clickBoardTarget(host,'.spot.legal');
  await expect(host.getByText(/setupRoad/)).toBeVisible();
  await expect(host.locator('.game-left-sidebar .event')).toContainText('plaatste een nederzetting');
  await expect(host.locator('.road-edge.legal')).toHaveCount(3);
  await clickBoardTarget(host,'.road-edge.legal');
  await expect(host.locator('.road-edge.legal')).toHaveCount(0,{timeout:5000});
  await expect(host.locator('.road-piece')).toHaveCount(1);
  await expect(host.locator('.road-piece').first()).toHaveAttribute('stroke-width','.2');
  const boardBounds=await host.locator('.board').boundingBox();expect(boardBounds).not.toBeNull();
  const initialViewBox=(await host.locator('.board').getAttribute('viewBox'))!.split(' ').map(Number);
  await host.mouse.move(boardBounds!.x+8,boardBounds!.y+8);await host.mouse.down();await host.mouse.move(boardBounds!.x+308,boardBounds!.y+8);await host.mouse.up();
  const pannedViewBox=(await host.locator('.board').getAttribute('viewBox'))!.split(' ').map(Number);
  expect(pannedViewBox[0]).toBeLessThan(initialViewBox[0]!);
  expect(Math.abs(pannedViewBox[0]!-initialViewBox[0]!)).toBeLessThan(initialViewBox[2]!);
  expect(pannedViewBox[1]).toBeCloseTo(initialViewBox[1]!,5);
  const originalViewBox=await host.locator('.board').getAttribute('viewBox');await host.getByRole('button',{name:'Inzoomen'}).click();await expect(host.locator('.board')).not.toHaveAttribute('viewBox',originalViewBox??'');await host.getByRole('button',{name:'Hercentreer'}).click();
  await guestContext.close();await hostContext.close();
});

test('desktop game layout fits common laptop and desktop viewports',async({browser})=>{
  const {host,hostContext,guestContext}=await createTwoHumansAndBot(browser);
  await host.getByRole('button',{name:'Start spel'}).click();
  await expect(host.locator('.board')).toBeVisible();
  const viewports=[{width:1920,height:1080},{width:1440,height:900},{width:1280,height:800},{width:1024,height:768}];
  for(const [index,viewport] of viewports.entries()){
    await host.setViewportSize(viewport);
    await host.evaluate(theme=>{document.documentElement.dataset.theme=theme;},index%2?'dark':'light');
    const layout=await host.evaluate(()=>{
      const board=document.querySelector<HTMLElement>('.boardcard')!.getBoundingClientRect();
      const bottomBar=document.querySelector<HTMLElement>('.bottom-bar')!.getBoundingClientRect();
      const leftSidebar=document.querySelector<HTMLElement>('.game-left-sidebar')!.getBoundingClientRect();
      const sidebar=document.querySelector<HTMLElement>('.game-sidebar')!.getBoundingClientRect();
      const svg=document.querySelector<SVGSVGElement>('.board')!.getBoundingClientRect();
      const bankColumns=getComputedStyle(document.querySelector<HTMLElement>('.bank-panel .hand')!).gridTemplateColumns.split(' ').length;
      return {viewportWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,viewportHeight:window.innerHeight,scrollHeight:document.documentElement.scrollHeight,leftSidebar:{left:leftSidebar.left,right:leftSidebar.right},board:{left:board.left,right:board.right,bottom:board.bottom,width:board.width},bottomBar:{top:bottomBar.top},sidebar:{left:sidebar.left,right:sidebar.right},svg:{width:svg.width,height:svg.height},bankColumns};
    });
    expect(layout.scrollWidth,`horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.scrollHeight,`vertical overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(layout.viewportHeight+1);
    expect(layout.leftSidebar.right).toBeLessThanOrEqual(layout.board.left);
    expect(layout.board.right).toBeLessThanOrEqual(layout.sidebar.left);
    expect(layout.board.bottom,`board overlaps bottom bar at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(layout.bottomBar.top);
    expect(layout.bankColumns,`bank items should wrap into three columns at ${viewport.width}x${viewport.height}`).toBe(3);
    expect(layout.svg.width,`board width at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeGreaterThan(250);
    expect(layout.svg.height,`board height at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeGreaterThan(250);
  }
  await expect(host.locator('.game-left-sidebar .players .player-panel')).toHaveCount(3);
  await expect(host.locator('.game-left-sidebar .player-card-count')).toHaveCount(3);
  await expect(host.locator('.game-left-sidebar .player-card-count').first()).toHaveText(/^\d+ kaarten$/);
  await expect(host.locator('.game-left-sidebar .player-panel').first()).not.toContainText(/VP zichtbaar|grondstofkaarten|ontwikkelingskaarten|ridders|handelsroute|wegen|steden/);
  await expect(host.locator('.game-left-sidebar .event-log-title')).toHaveText('Gebeurtenissen');
  await guestContext.close();await hostContext.close();
});

test('both humans complete the full setup on the board and roll to begin play',async({browser})=>{
  const {host,hostContext,guest,guestContext}=await createTwoHumansAndBot(browser);await host.getByRole('button',{name:'Start spel'}).click();
  for(let step=0;step<40;step++){
    const phaseText=await host.locator('.game-sidebar>p.muted').textContent();if(phaseText?.includes('Fase: roll'))break;
    const active=await host.locator('.player-panel.active').textContent();if(!active)continue;
    if(active.includes('Bot 1')){await expect.poll(async()=>!(await host.locator('.player-panel.active').textContent())?.includes('Bot 1'),{timeout:10000}).toBe(true);continue;}
    const page=active.includes('Host')?host:guest;
    if(phaseText?.includes('setupSettlement')){await clickBoardTarget(page,'.spot.legal');await expect(page.locator('.game-sidebar>p.muted')).toContainText('setupRoad');}
    if((await page.locator('.game-sidebar>p.muted').textContent())?.includes('setupRoad')){await clickBoardTarget(page,'.road-edge.legal');await expect(page.locator('.game-sidebar>p.muted')).not.toContainText('setupRoad',{timeout:5000});}
  }
  await expect(host.locator('.game-sidebar>p.muted')).toContainText('Fase: roll');await expect(host.locator('.player-panel.active')).toContainText('Host');
  await host.setViewportSize({width:1024,height:768});
  const bankTotal=await host.locator('.bank-panel .resource b').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent),0));expect(bankTotal).toBeLessThan(95);
  await host.getByRole('button',{name:'Gooi de dobbelstenen'}).click();await expect.poll(async()=>await host.locator('.game-sidebar>p.muted').textContent()).toMatch(/Fase: (robber|build)/);if((await host.locator('.game-sidebar>p.muted').textContent())?.includes('Fase: robber')){await clickBoardTarget(host,'.legal-tile');if(await host.locator('.victim-picker').count())await host.locator('.victim-picker button').first().click();}await expect(host.locator('.game-sidebar>p.muted')).toContainText('Fase: build');
  await host.getByRole('button',{name:'Weg',exact:true}).click();await expect(host.locator('.road-edge.legal').first()).toBeVisible();await clickBoardTarget(host,'.road-edge.legal');await expect(host.locator('.road-piece')).toHaveCount(7);
  await guestContext.close();await hostContext.close();
});

test('both browser contexts receive their own named seat and server-started game',async({browser})=>{
  const {host,guest,hostContext,guestContext}=await createTwoHumansAndBot(browser);
  await expect(host.getByRole('button',{name:'Start spel'})).toBeEnabled();
  await host.getByRole('button',{name:'Start spel'}).click();
  await expect(host.locator('[data-game-lifecycle="started"]')).toBeVisible();
  await expect(guest.locator('[data-game-lifecycle="started"]')).toBeVisible();
  await expect(host.getByText('Host',{exact:true})).toBeVisible();await expect(guest.getByText('Guest',{exact:true})).toBeVisible();
  await expect(host.getByText('25 ontwikkelingskaarten over')).toBeVisible();
  await expect(host.locator('.bank-panel .resource')).toHaveCount(5);
  await expect(host.locator('.bottom-bar .resource').first()).toContainText('brick');
  await expect(host.locator('.bottom-bar .resource').nth(1)).toContainText('hout');
  await expect(host.locator('.bottom-bar .resource').nth(2)).toContainText('wol');
  await expect(host.locator('.bottom-bar .resource').nth(3)).toContainText('graan');
  await expect(host.locator('.bottom-bar .resource').nth(4)).toContainText('erts');
  await guest.reload();await expect(guest.locator('[data-game-lifecycle="started"]')).toBeVisible();
  await guest.locator('.chat-form input').fill('Hoi!');await guest.locator('.chat-form button').click();await expect(host.getByText('Guest: Hoi!')).toBeVisible();
  await host.getByRole('button',{name:'Debug',exact:true}).click();await host.locator('.debug-actions>summary').click();await expect(host.getByRole('button',{name:'Kopieer debugbundel'})).toBeVisible();await expect(host.getByRole('button',{name:'Download replay'})).toBeVisible();await expect(host.locator('.debug-json').first()).toContainText('"viewHashMatches": true');
  await guestContext.close();await hostContext.close();
});
