# usage: python3 tools/shot.py URL out_prefix [waitms] [script.json]
import sys, json, asyncio, os
sys.path.insert(0, os.path.dirname(__file__)); import serve
serve.start(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 8123)
from playwright.async_api import async_playwright
CHROME='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
async def main():
    url=sys.argv[1]; out=sys.argv[2]; wait=int(sys.argv[3]) if len(sys.argv)>3 else 3000
    steps=json.load(open(sys.argv[4])) if len(sys.argv)>4 else []
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1280,'height':720})
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(url); await pg.wait_for_timeout(wait)
        n=0
        for s in steps:
            k=s[0]
            if k=='wait': await pg.wait_for_timeout(s[1])
            elif k=='down': await pg.keyboard.down(s[1])
            elif k=='up': await pg.keyboard.up(s[1])
            elif k=='press': await pg.keyboard.press(s[1])
            elif k=='click': await pg.click(s[1])
            elif k=='eval': logs.append('[eval] '+json.dumps(await pg.evaluate(s[1])))
            elif k=='shot': await pg.screenshot(path=f'{out}_{s[1]}.png'); n+=1
        if not steps: await pg.screenshot(path=f'{out}.png')
        try: logs.append('[out] '+json.dumps(await pg.evaluate('window.__out')))
        except Exception as e: pass
        print('\n'.join(logs[-60:]))
        await b.close()
asyncio.run(main())
