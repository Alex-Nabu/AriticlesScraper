const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');


// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json'));

axios.defaults.headers.common['User-Agent'] ='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36';
axios.defaults.headers.common['Cookie'] = 'intercom-id-cjcr7hhj=a13c8450-4814-4230-8229-b99cfdb0efe1; intercom-session-cjcr7hhj=; intercom-device-id-cjcr7hhj=beae6ed8-060a-4930-ab81-94f20d6e2dcd; _gcl_au=1.1.1723280162.1719893331; _gid=GA1.2.274320345.1719893331; _vwo_uuid_v2=DD16948DDFDA1A54EF6D4BE77B39E5AF5|0093c3ef367b22652996c8117d4b06eb; _vwo_uuid=DD16948DDFDA1A54EF6D4BE77B39E5AF5; _vwo_ds=3%241719893528%3A5.81251933%3A%3A; _vis_opt_s=1%7C; _vis_opt_test_cookie=1; _vis_opt_exp_75_exclude=1; __hstc=69106254.b5712e91c0196fa495651b773a842bee.1719893532274.1719893532274.1719893532274.1; hubspotutk=b5712e91c0196fa495651b773a842bee; __hssrc=1; _fbp=fb.1.1719893600270.162049308490252505; _uetsid=6a7f6750382911ef915ff7f935e91b9b; _uetvid=6a7f7240382911ef8fd3697f09e380cb; fs_uid=#314T2#7f09aef1-11c0-40ad-90f1-07c40872b65f:ffc46fe0-f44c-4be4-8b48-3bdd6db019b5:1719893601023::1#/1751429602; _ga=GA1.1.1904335721.1719893331; _ga_T4CCQVL165=GS1.1.1719896616.2.1.1719900683.43.0.21951278';

const blogs = config.blog;
const tempFileName = config.cache;
const saveFile = config.saveFile;

async function getArticleLinksPuppeteer(blog) {
    console.log(`Fetching main page for blog: ${blog.url} using Puppeteer...`);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(blog.url, { waitUntil: 'networkidle2' });
    const content = await page.content();
    const $ = cheerio.load(content);
    const articleLinks = [];

    console.log('Extracting article links...');
    $('a').each((i, element) => {
        const href = $(element).attr('href');
        if (href && blog.articleLinksSlug.some(slug => href.includes(slug))) {
            articleLinks.push(new URL(href, blog.url).href); // Ensure full URL
        }
    });

    await browser.close();
    console.log(`Found ${articleLinks.length} article links for blog: ${blog.url}.`);
    return articleLinks;
}

async function getArticleLinksAxios(blog) {
    console.log(`Fetching main page for blog: ${blog.url} using Axios...`);
    const response = await axios.get(blog.url);
    const $ = cheerio.load(response.data);
    const articleLinks = [];

    console.log('Extracting article links...');
    $('a').each((i, element) => {
        const href = $(element).attr('href');
        if (href && blog.articleLinksSlug.some(slug => href.includes(slug))) {
            articleLinks.push(new URL(href, blog.url).href); // Ensure full URL
        }
    });

    console.log(`Found ${articleLinks.length} article links for blog: ${blog.url}.`);
    return articleLinks;
}

async function getArticleDetailsPuppeteer(url, count, domainName, blog) {
    console.log(`Fetching article: ${url} using Puppeteer...`);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const content = await page.content();
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

    await browser.close();
    console.log(`Fetched article: ${title}`);
    return {
        id,
        html_url: url,
        title,
        body: bodyContent,
        strictMatch: strictMatch
    };
}

async function getArticleDetailsAxios(url, count, domainName, blog) {
    console.log(`Fetching article: ${url} using Axios...`);
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
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
    return {
        id,
        html_url: url,
        title,
        body: bodyContent,
        strictMatch: strictMatch
    };
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

    for (const blog of blogs) {
        const domainName = new URL(blog.url).hostname;
        let articleLinks;

        if (blog.puppeteer) {
            articleLinks = await getArticleLinksPuppeteer(blog);
        } else {
            articleLinks = await getArticleLinksAxios(blog);
        }

        const processedLinks = new Set(articles.map(article => article.html_url));
        let count = articles.filter(article => article.html_url.includes(domainName)).length + 1;

        for (const link of articleLinks) {
            if (!processedLinks.has(link)) {
                let articleDetails;

                if (blog.puppeteer) {
                    articleDetails = await getArticleDetailsPuppeteer(link, count, domainName, blog);
                } else {
                    articleDetails = await getArticleDetailsAxios(link, count, domainName, blog);
                }

                articles.push(articleDetails);
                saveArticles(articles);  // Save progress after each article
                console.log(`Article saved: ${articleDetails.title}`);
                count++;
            }
        }
    }

    fs.writeFileSync(saveFile, JSON.stringify(articles, null, 2));
    console.log(`All articles have been saved to ${saveFile}`);

    let myArray = stripHtmlTags(saveFile, saveFile.replace('.json', '_processed.json'));
}

scrapeArticles().catch(console.error);
