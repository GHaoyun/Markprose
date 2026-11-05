const { chromium } = require(process.env.PW_PATH || "playwright-core");
const URL = "http://localhost:4180/";
const EMPTY = { sessionTabs: [], sessionActive: null, sessionState: {}, sessionDrafts: [] };
const VFS = { "/demo/甲.md": "# 甲\n\n内容\n" };

async function open(b, { mode = "off", anim = false, ses = EMPTY } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ mode, anim, ses, VFS }) => {
    localStorage.setItem("moke.settings", JSON.stringify({
      lastFolder: "/demo", theme: "pine", autosave: false,
      sessionMode: mode, bootAnimation: anim, ...(ses || {})
    }));
    localStorage.setItem("moke.vfs.v1", JSON.stringify(VFS));
    localStorage.setItem("moke.pending", JSON.stringify([]));
    localStorage.removeItem("moke.startup");
  }, { mode, anim, ses, VFS });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: "load" });
  return { ctx, p, errs };
}

(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });

  // 关键回归：开启动画 + 不保留模式 + 没有上次内容 → 以前永远不播
  {
    const { ctx, p, errs } = await open(b, { mode: "off", anim: true });
    await p.waitForTimeout(300);
    const splash = await p.evaluate(() => !!document.querySelector(".boot-splash"));
    await p.waitForTimeout(1000);
    console.log("ANIM-ON-NO-SESSION " + JSON.stringify({
      splash, gone: await p.evaluate(() => !document.querySelector(".boot-splash")),
      toast: await p.evaluate(() => !!document.querySelector(".ask-toast")),
      errs: errs.slice(0,2),
    }));
    await ctx.close();
  }

  // 询问模式但没有上次内容 → 也该播
  {
    const { ctx, p, errs } = await open(b, { mode: "ask", anim: true });
    await p.waitForTimeout(300);
    console.log("ANIM-ON-ASK-EMPTY " + JSON.stringify({
      splash: await p.evaluate(() => !!document.querySelector(".boot-splash")),
      errs: errs.slice(0,2),
    }));
    await ctx.close();
  }

  // 关闭动画 → 不播
  {
    const { ctx, p, errs } = await open(b, { mode: "ask", anim: false });
    await p.waitForTimeout(300);
    console.log("ANIM-OFF " + JSON.stringify({
      splash: await p.evaluate(() => !!document.querySelector(".boot-splash")),
      errs: errs.slice(0,2),
    }));
    await ctx.close();
  }

  // 询问 + 有内容：动画只播一次，小提示仍出现
  {
    const ses = { sessionTabs: ["/demo/甲.md"], sessionActive: "/demo/甲.md", sessionState: {}, sessionDrafts: [] };
    const { ctx, p, errs } = await open(b, { mode: "ask", anim: true, ses });
    await p.waitForTimeout(300);
    const splashes = await p.evaluate(() => document.querySelectorAll(".boot-splash").length);
    await p.waitForTimeout(1100);
    console.log("ASK-WITH-CONTENT " + JSON.stringify({
      splashes, toast: await p.evaluate(() => !!document.querySelector(".ask-toast")),
      errs: errs.slice(0,2),
    }));
    await ctx.close();
  }

  // 开关点了立刻写盘 + 文案检查
  {
    const { ctx, p, errs } = await open(b, { mode: "off", anim: false });
    await p.waitForTimeout(1200);
    await p.locator("#btn-settings").click();
    await p.waitForTimeout(500);
    const texts = await p.evaluate(() => Array.from(document.querySelectorAll(".set-row .d")).map(e => e.textContent));
    const bad = texts.filter(t => /代码|备用|生效|如何处理|写回磁盘|越大越松散/.test(t));
    await p.evaluate(() => {
      const r = Array.from(document.querySelectorAll(".set-row")).find(x => x.textContent.includes("启动动画"));
      const sw = r && r.querySelector(".switch"); if (sw) sw.click();
    });
    // 不等防抖，立刻读
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("moke.settings")).bootAnimation);
    console.log("SETTINGS " + JSON.stringify({ badTexts: bad, savedImmediately: saved, samples: texts.slice(0, 6), errs: errs.slice(0,2) }));
    await ctx.close();
  }

  await b.close();
})();
