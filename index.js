
/**
 * @desc                Khoa Nguyen
 * @version             0.1
 */
const scrapeUrl = 'https://www.dl1961.com/collections/tapered-slim';
const storeDBPath = `${__dirname}/storage_scrapped/db.json`;

const Apify = require('apify');
const PuppeteerPool = Apify.PuppeteerPool;

const FS = require('fs');
if(FS.existsSync(storeDBPath)) {
    FS.unlinkSync(storeDBPath);
}
const CONFIG = Object.freeze(
    require('./config.json')
);

const writeFileSyncRecursive = (url, json) => {
    // create folder path if not exists
    storeDBPath.split('/').slice(0,-1).reduce( (last, folder)=>{
        let folderPath = last ? (last + '/' + folder) : folder
        if (!FS.existsSync(folderPath)) FS.mkdirSync(folderPath)
        return folderPath
    });

    FS.appendFileSync(storeDBPath, url + '\n' + JSON.stringify(json, null, 4) + '\n\n');
}

(async () => {
    const puppeteerPool = new PuppeteerPool({
        launchPuppeteerOptions: {
            headless: true
        }
    });

    try {
        const page = await puppeteerPool.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setViewport({width: 1200, height: 850});

        await page.goto(scrapeUrl).then(() => console.log('Browser opened'));

        const itemUrls = await page.evaluate(CONFIG => {
            let S_items = document.querySelectorAll(CONFIG.product_index);
            let S_maxSelectCount = Math.min(5, S_items.length);
            let S_i = 0;
            let S_returnArr = [];

            while(S_i < S_maxSelectCount) {
                const S_itemUrl = S_items[S_i].querySelector(CONFIG.product_image_url).getAttribute('href');
                S_returnArr.push(window.location.origin + S_itemUrl);
                S_i ++;
            };

            return S_returnArr;
        }, CONFIG);

        if(itemUrls.length > 0) {
            itemUrls.forEach(async itemUrl => {
                try {
                    const newPage = await puppeteerPool.newPage();

                    await newPage.goto(itemUrl);
                    await newPage.waitForSelector('#logo');
                    const results = await newPage.evaluate(async CONFIG => {
                        let S_results = {};
                        let colors = Object.freeze({
                            '0': 'blue',
                            '1': 'drakblue',
                            '2': 'brown'
                        });
                        const switchColorList = document.querySelector(CONFIG.product_shop_color_swatch_list).children;
                        // utilities
                        async function asyncForEach(array, callback) {
                            for (let index = 0; index < array.length; index++) {
                                await callback(array[index], index, array);
                            }
                        }
                        const waitFor = ms => new Promise(res => setTimeout(res, ms));

                        await asyncForEach(switchColorList, async (domColor, index) => {
                            domColor.click();
                            await waitFor(500);
                            // get scrapped data
                            // GET product-description according color...
                            let S_result = {};
                            let S_ul_childrens = document.querySelector(CONFIG.accordion_two);
                            if(!S_ul_childrens) S_ul_childrens = document.querySelector(CONFIG.div_desc);
                            S_ul_childrens = S_ul_childrens.children;

                            S_result = {
                                produtShopFamilyTitle: document.querySelector(CONFIG.product_shop_family_title).textContent.trim(),
                                productShopTitle: document.querySelector(CONFIG.product_shop_title).textContent.trim(),
                                productShopPrice: document.querySelector(CONFIG.product_shop_price).textContent.trim(),

                                overviewString: S_ul_childrens[0].textContent.trim(),
                                details: []
                            };
                            Array.from(S_ul_childrens[1].children).forEach(item => {
                                S_result.details.push(item.textContent.trim());
                            });

                            // get all images
                            var slideGallery = document.querySelector(`${CONFIG.div_slide_gallery}:nth-child(${index+1})`);
                            var imgUrls = Array.from(slideGallery.querySelectorAll(CONFIG.li_thumb)).map(item => {
                                return window.location.protocol + item.querySelector(CONFIG.high_quality_img).getAttribute('src');
                            });
                            S_results[colors[index]] = {
                                product: S_result,
                                imageUrls: imgUrls
                            };
                        });
                        return S_results;
                    }, CONFIG);
                    writeFileSyncRecursive(itemUrl, results);
                    await newPage.close();
                } catch (e) {
                    await puppeteerPool.destroy();
                }
            });
        }
        await page.close();

        let gcTimer = setInterval(async () => {
            let browserInstances = puppeteerPool.activeInstances;
            for(let i = 0; i < puppeteerPool.browserCounter; i ++) {
                if(browserInstances[i] && browserInstances[i].activePages === 0) {
                    console.log('Bye for now');
                    await puppeteerPool.destroy();
                    clearTimeout(gcTimer);
                }
            }
        }, 2000);
    } catch(e) {
        await puppeteerPool.destroy();
    }
})();