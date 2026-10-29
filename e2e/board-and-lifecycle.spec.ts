import { expect, test, type Browser } from '@playwright/test';

async function createTwoHumansAndBot(browser:Browser){
  const hostContext=await browser.newContext();const guestContext=await browser.newContext();
  const host=await hostContext.newPage();const guest=await guestContext.newPage();
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
  await guestContext.close();await hostContext.close();
});
