const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('pageerror', err => {
    console.log('Page Error: ', err.toString());
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Console Error: ', msg.text());
    }
  });

  await page.goto('http://localhost:5173/#admin');
  
  // Wait a bit to let React render
  await new Promise(r => setTimeout(r, 2000));
  
  // Try to type password "debug" and click unlock
  try {
      await page.type('input[placeholder="ENTER KEY"]', '1234');
      await page.click('button.btn');
      await new Promise(r => setTimeout(r, 2000));
  } catch(e) {}

  await browser.close();
})();
