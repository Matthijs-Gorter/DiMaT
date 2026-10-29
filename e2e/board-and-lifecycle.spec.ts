import { expect, test, type Browser } from '@playwright/test';

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

test('lobby does not expose action submission before the server starts the game',async({browser})=>{
  const {host,hostContext,guestContext}=await createTwoHumansAndBot(browser);
  await expect(host.locator('.actions')).toBeHidden();
  await host.evaluate(()=>{(window as Window&{dimatSend?:WebSocket}).dimatSend?.send(JSON.stringify({type:'action',sequence:1,action:{type:'placeSettlement',playerId:'p0',vertex:0}}));});
  await expect(host.getByText(/GAME_NOT_STARTED/)).toBeVisible();
  await guestContext.close();await hostContext.close();
});

test('setup roads have direct legal edge hit targets on the board',async({browser})=>{
  const {host,hostContext,guest,guestContext}=await createTwoHumansAndBot(browser);
  await host.getByRole('button',{name:'Start spel'}).click();
  await expect(host.locator('.spot.legal')).toHaveCount(54,{timeout:5000});
  await host.locator('.spot.legal').first().click();
  await expect(host.getByText(/setupRoad/)).toBeVisible();
  await expect(host.locator('.road-edge.legal')).toHaveCount(3);
  await host.locator('.road-edge.legal').first().click();
  await expect(host.locator('.road-edge.legal')).toHaveCount(0,{timeout:5000});
  await expect(host.locator('.road-piece')).toHaveCount(1);
  const originalViewBox=await host.locator('.board').getAttribute('viewBox');await host.getByRole('button',{name:'Inzoomen'}).click();await expect(host.locator('.board')).not.toHaveAttribute('viewBox',originalViewBox??'');await host.getByRole('button',{name:'Hercentreer'}).click();
  await guestContext.close();await hostContext.close();
});

test('both humans complete the full setup on the board and roll to begin play',async({browser})=>{
  const {host,hostContext,guest,guestContext}=await createTwoHumansAndBot(browser);await host.getByRole('button',{name:'Start spel'}).click();
  for(let step=0;step<40;step++){
    const phaseText=await host.locator('.game-sidebar>p.muted').textContent();if(phaseText?.includes('Fase: roll'))break;
    const active=await host.locator('.player-panel.active').textContent();if(!active)continue;
    if(active.includes('Bot 1')){await expect.poll(async()=>!(await host.locator('.player-panel.active').textContent())?.includes('Bot 1'),{timeout:10000}).toBe(true);continue;}
    const page=active.includes('Host')?host:guest;
    if(phaseText?.includes('setupSettlement')){await page.locator('.spot.legal').first().click();await expect(page.locator('.game-sidebar>p.muted')).toContainText('setupRoad');}
    if((await page.locator('.game-sidebar>p.muted').textContent())?.includes('setupRoad'))await page.locator('.road-edge.legal').first().click();
  }
  await expect(host.locator('.game-sidebar>p.muted')).toContainText('Fase: roll');await expect(host.locator('.player-panel.active')).toContainText('Host');
  const bankTotal=await host.locator('.bank-panel .resource b').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent),0));expect(bankTotal).toBeLessThan(95);
  await host.getByRole('button',{name:'Gooi de dobbelstenen'}).click();await expect.poll(async()=>await host.locator('.game-sidebar>p.muted').textContent()).toMatch(/Fase: (robber|build)/);if((await host.locator('.game-sidebar>p.muted').textContent())?.includes('Fase: robber')){await host.locator('.legal-tile').first().click();if(await host.locator('.victim-picker').count())await host.locator('.victim-picker button').first().click();}await expect(host.locator('.game-sidebar>p.muted')).toContainText('Fase: build');
  await host.getByRole('button',{name:'Weg',exact:true}).click();await expect(host.locator('.road-edge.legal').first()).toBeVisible();await host.locator('.road-edge.legal').first().click();await expect(host.locator('.road-piece')).toHaveCount(7);
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
  await guest.reload();await expect(guest.locator('[data-game-lifecycle="started"]')).toBeVisible();
  await guest.locator('.chat-form input').fill('Hoi!');await guest.locator('.chat-form button').click();await expect(host.getByText('Guest: Hoi!')).toBeVisible();
  await host.getByRole('button',{name:'Debug',exact:true}).click();await host.locator('.debug-actions>summary').click();await expect(host.getByRole('button',{name:'Kopieer debugbundel'})).toBeVisible();await expect(host.getByRole('button',{name:'Download replay'})).toBeVisible();await expect(host.locator('.debug-json').first()).toContainText('"viewHashMatches": true');
  await guestContext.close();await hostContext.close();
});
