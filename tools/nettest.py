# Two-browser online test: host creates a room, guest joins, host starts, both play.
import asyncio, json, sys
from playwright.async_api import async_playwright
CHROME='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
URL='http://127.0.0.1:8130/index.html'
OUT=sys.argv[1]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        logs=[]
        async def page(name):
            ctx=await b.new_context(viewport={'width':960,'height':540})
            pg=await ctx.new_page()
            pg.on('console', lambda m: logs.append(f'[{name}:{m.type}] {m.text}') if m.type in ('error','warning') else None)
            pg.on('pageerror', lambda e: logs.append(f'[{name}:pageerror] {e}'))
            await pg.goto(URL)
            for _ in range(120):
                if await pg.evaluate('!!window.__game'): break
                await pg.wait_for_timeout(1000)
            else:
                print('\n'.join(logs)); raise SystemExit(name+' did not load')
            return pg
        host=await page('host'); guest=await page('guest')
        await host.click('.seg.tabs button[data-v="online"]'); await host.fill('#in-name','Toronto')
        await host.click('#btn-create'); await host.wait_for_selector('#lobby.show', timeout=10000)
        code=await host.inner_text('#lobby-code'); print('code', code)
        await guest.click('.seg.tabs button[data-v="online"]'); await guest.fill('#in-name','小美'); await guest.fill('#in-code', code)
        await guest.click('#btn-join'); await guest.wait_for_selector('#lobby.show', timeout=10000)
        await host.wait_for_timeout(800)
        print('host lobby:', await host.inner_text('#lobby-slots'))
        print('guest lobby:', await guest.inner_text('#lobby-slots'))
        await host.screenshot(path=OUT+'_lobby.png')
        await host.click('#btn-lobby-start')
        await guest.wait_for_function('window.__game.role==="guest"', timeout=10000)
        await host.evaluate('window.__hold=true')
        async def run(sec):
            for _ in range(int(sec*6)):
                await host.evaluate('window.__step(10,1/60,false)')
                await host.wait_for_timeout(30)
        await run(3)
        # guest moves left for a while
        await guest.keyboard.down('KeyA'); await guest.wait_for_timeout(500); await run(2.5)
        await guest.screenshot(path=OUT+'_guest_run.png')
        await guest.keyboard.up('KeyA')
        st=await host.evaluate('(()=>{const g=window.__game;return {state:g.state,pos:g.athletes.map(a=>[+a.pos.x.toFixed(2),+a.pos.z.toFixed(2)]),labels:g.athletes.map(a=>a.label),ctl:g.controllers.map(c=>c.type)}})()')
        sg=await guest.evaluate('(()=>{const g=window.__game;return {mode:g.camMode,shake:g.shake,focus:!!g.focus,campos:g.camPos.toArray().map(v=>+v.toFixed(1)),cam:g.camera.position.toArray().map(v=>+v.toFixed(1)),look:g.camLook.toArray().map(v=>+v.toFixed(1)),fov:g.camera.fov,asp:g.camera.aspect,state:g.state,snaps:g.snaps.length,pos:g.athletes.map(a=>[+a.pos.x.toFixed(2),+a.pos.z.toFixed(2)]),mySlot:g.mySlot,ball:g.ball.pos.toArray().map(v=>+v.toFixed(2))}})()')
        print('host', json.dumps(st)); print('guest', json.dumps(sg))
        await guest.screenshot(path=OUT+'_guest.png'); await host.screenshot(path=OUT+'_host.png')
        print('\n'.join(logs[-20:]))
        await b.close()
asyncio.run(main())
