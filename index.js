const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json'));

const blogs = config.blog;
const tempFileName = config.cache;
const classNames = config.articleBodyTags;
const saveFile = config.saveFile;
const articleLinksSlugs = config.articleLinksSlug;

async function getArticleLinks(blog) {
    console.log(`Fetching main page for blog: ${blog}...`);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(blog, { waitUntil: 'networkidle2' });
    const content = await page.content();
    const $ = cheerio.load(content);
    const articleLinks = [];

    console.log('Extracting article links...');
    $('a').each((i, element) => {
        const href = $(element).attr('href');
        if (href && articleLinksSlugs.some(slug => href.includes(slug))) {
            articleLinks.push(new URL(href, blog).href); // Ensure full URL
        }
    });

    await browser.close();
    console.log(`Found ${articleLinks.length} article links for blog: ${blog}.`);
    return articleLinks;
}

async function getArticleDetails(url, count, domainName) {
    console.log(`Fetching article: ${url}`);
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
    for (const className of classNames) {
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
        const domainName = new URL(blog).hostname;
        const articleLinks = await getArticleLinks(blog);
        const processedLinks = new Set(articles.map(article => article.html_url));
        let count = articles.filter(article => article.html_url.includes(domainName)).length + 1;

        for (const link of articleLinks) {
            if (!processedLinks.has(link)) {
                const articleDetails = await getArticleDetails(link, count, domainName);
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
