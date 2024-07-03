const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const { parseStringPromise } = require('xml2js');

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json'));

const blogs = config.blog;
const tempFileName = config.cache;
const saveFile = config.saveFile;
const maxDepth = config.maxDepth || 3; // Limit the crawling depth

axios.defaults.headers.common['User-Agent'] ='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36';
axios.defaults.headers.common['Cookie'] = 'intercom-id-cjcr7hhj=a13c8450-4814-4230-8229-b99cfdb0efe1; intercom-session-cjcr7hhj=; intercom-device-id-cjcr7hhj=beae6ed8-060a-4930-ab81-94f20d6e2dcd; _gcl_au=1.1.1723280162.1719893331; _gid=GA1.2.274320345.1719893331; _vwo_uuid_v2=DD16948DDFDA1A54EF6D4BE77B39E5AF5|0093c3ef367b22652996c8117d4b06eb; _vwo_uuid=DD16948DDFDA1A54EF6D4BE77B39E5AF5; _vwo_ds=3%241719893528%3A5.81251933%3A%3A; _vis_opt_s=1%7C; _vis_opt_test_cookie=1; _vis_opt_exp_75_exclude=1; __hstc=69106254.b5712e91c0196fa495651b773a842bee.1719893532274.1719893532274.1719893532274.1; hubspotutk=b5712e91c0196fa495651b773a842bee; __hssrc=1; _fbp=fb.1.1719893600270.162049308490252505; _uetsid=6a7f6750382911ef915ff7f935e91b9b; _uetvid=6a7f7240382911ef8fd3697f09e380cb; fs_uid=#314T2#7f09aef1-11c0-40ad-90f1-07c40872b65f:ffc46fe0-f44c-4be4-8b48-3bdd6db019b5:1719893601023::1#/1751429602; _ga=GA1.1.1904335721.1719893331; _ga_T4CCQVL165=GS1.1.1719896616.2.1.1719900683.43.0.21951278';

const checkedUrls = new Set();

function isSameDomain(url1, url2) {
    const domain1 = new URL(url1).hostname;
    const domain2 = new URL(url2).hostname;
    return domain1 === domain2;
}

async function getArticleLinks(browser, blog, depth = 0) {
    if (depth > maxDepth || checkedUrls.has(blog.url)) {
        return [];
    }
    checkedUrls.add(blog.url);

    let pageContent;
    if (blog.puppeteer) {
        const page = await browser.newPage();
        console.log(`Fetching page with Puppeteer: ${blog.url}...`);
        await page.goto(blog.url, { waitUntil: 'networkidle2' });
        pageContent = await page.content();
        await page.close(); // Close the page after extracting content
    } else {
        console.log(`Fetching page with Axios: ${blog.url}...`);
        try {
            const response = await axios.get(blog.url, { maxRedirects: 5 });
            pageContent = response.data;
        } catch (error) {
            if (error.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
                console.error(`Too many redirects for URL: ${blog.url}`);
            } else {
                console.error(`Error fetching URL: ${blog.url}`, error.message);
            }
            return [];
        }
    }

    const $ = cheerio.load(pageContent);
    const articleLinks = [];
    const internalLinks = new Set();

    console.log('Extracting links...');
    $('body a').each((i, element) => {
        const href = $(element).attr('href');
        if (href) {
            const fullUrl = new URL(href, blog.url).href;
            if (isSameDomain(fullUrl, blog.url)) {
                if (blog.articleLinksSlug.some(slug => fullUrl.includes(slug))) {
                    articleLinks.push(fullUrl);
                } else {
                    internalLinks.add(fullUrl);
                }
            }
        }
    });

    // Recursively visit internal links
    for (const link of internalLinks) {
        const newLinks = await getArticleLinks(browser, { ...blog, url: link }, depth + 1);
        articleLinks.push(...newLinks);
    }

    return articleLinks;
}


const checkedArticleUrls = new Set();
async function getArticleDetails(page, url, count, domainName, blog) {
    if (checkedArticleUrls.has(url)) {
        console.log(`Skipping already processed article: ${url}`);
        return null;
    }

    console.log(`Fetching article: ${url}`);
    try {
        let content;
        if (blog.puppeteer) {
            await page.goto(url, { waitUntil: 'networkidle2' });
            content = await page.content();
        } else {
            const response = await axios.get(url);
            content = response.data;
        }
        const $ = cheerio.load(content);
        const id = `${domainName}#${count}`;
        const title = $('title').text();
        let bodyContent = '';
        let strictMatch = false;

        // Check for specified class names and extract their content if found
        for (const className of blog.articleBodyTags) {
            const element = $(`.${className}`);
            if (element.length) {
                bodyContent += element.html();
                strictMatch = true; // Found at least one matching class name
            }
        }

        // If no specified class names are found, use the whole body content
        if (!bodyContent) {
            bodyContent = $('body').html();
            strictMatch = false;
        }

        console.log(`Fetched article: ${title}`);
        checkedUrls.add(url); // Mark URL as processed
        return {
            id,
            html_url: url,
            title,
            body: bodyContent,
            strictMatch: strictMatch
        };
    } catch (error) {
        console.error(`Error fetching article: ${url}`, error.message);
        return null; // or handle the error in a way appropriate for your application
    }
}

/**
 * Function to strip HTML tags from the body content of articles in a JSON file.
 * @param {string} inputFilePath - The path to the input JSON file.
 * @param {string} outputFilePath - The path to save the processed JSON file.
 */
function stripHtmlTags(inputFilePath, outputFilePath) {
    // Read the JSON file
    const rawData = fs.readFileSync(inputFilePath);
    const articles = JSON.parse(rawData);

    // Process each article
    const domainCounts = {};
    const processedArticles = articles
        .filter(article => article.strictMatch) // Only process articles with strictMatch = true
        .map(article => {
            if (article.body) {
                const $ = cheerio.load(article.body);
                // Remove all images
                $('img').remove();
                // Get text content with line breaks
                article.body = $.text().replace(/\n+/g, '\n');
            }
            const domainName = article.id.split('#')[0];
            if (!domainCounts[domainName]) {
                domainCounts[domainName] = 1;
            }
            article.id = `${domainName}#${domainCounts[domainName]}`;
            domainCounts[domainName]++;
            return article;
        });

    // Write the processed articles to a new JSON file
    fs.writeFileSync(outputFilePath, JSON.stringify(processedArticles, null, 2));
    console.log(`Processed articles have been saved to ${outputFilePath}`);

    return processedArticles;
}

function saveArticles(articles) {
    fs.writeFileSync(tempFileName, JSON.stringify(articles, null, 2));
    console.log(`Progress saved to ${tempFileName}`);
}

async function scrapeArticles() {
    let articles = [];

    // Load existing articles if the temp file exists
    if (fs.existsSync(tempFileName)) {
        articles = JSON.parse(fs.readFileSync(tempFileName));
        console.log(`Loaded ${articles.length} articles from previous run.`);
    }

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    for (const blog of blogs) {
        const domainName = new URL(blog.url).hostname;
        const articleLinks = await getArticleLinks(browser, blog, 0);
        const processedLinks = new Set(articles.map(article => article.html_url));
        let count = articles.filter(article => article.html_url.includes(domainName)).length + 1;

        for (const link of articleLinks) {
            if (!processedLinks.has(link)) {
                const articleDetails = await getArticleDetails(page, link, count, domainName, blog);
                if(articleDetails === null) continue;
                articles.push(articleDetails);
                saveArticles(articles);  // Save progress after each article
                console.log(`Article saved: ${articleDetails.title}`);
                count++;
            }
        }
    }

    await browser.close();

    fs.writeFileSync(saveFile, JSON.stringify(articles, null, 2));
    console.log(`All articles have been saved to ${saveFile}`);

    let myArray = stripHtmlTags(saveFile, saveFile.replace('.json', '_processed.json'));
}

scrapeArticles().catch(console.error);
