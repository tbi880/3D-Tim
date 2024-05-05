import { SitemapStream, streamToPromise } from 'sitemap';
import { createWriteStream } from 'fs';

const links = [
    { url: '/', changefreq: 'monthly', priority: 1.0 },
    { url: '/jessie', changefreq: 'monthly', priority: 0.7 },
    // 添加更多页面链接
];

const sitemap = new SitemapStream({ hostname: 'https://www.bty.co.nz' });

streamToPromise(sitemap)
    .then(content => {
        // 输出sitemap.xml内容到文件
        createWriteStream("public/sitemap.xml").write(content);
    })
    .catch(e => console.error(e));

links.forEach(link => sitemap.write(link));
sitemap.end();
