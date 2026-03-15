const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { URL } = require("url");
const { execSync } = require("child_process");

const categories = JSON.parse(fs.readFileSync("categories.json"));

const TEST_MODE = false;



// =========================
// AXIOS CONFIG
// =========================
const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "th-TH,th;q=0.9"
  },
  timeout: 20000
});

const delay = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = (min=100,max=300) =>
  delay(Math.floor(Math.random()*(max-min))+min);

function normalizeUrl(url) {
  if (!url) return null;
  return url.split("?")[0].replace(/\/+$/, "");
}

function fixCategoryUrl(url) {
  if (!url) return url;

  return url
    .replace(/\/category\/category\//, "/category/")
    .replace(/([^:]\/)\/+/g, "$1");
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.","");
  } catch {
    return "";
  }
}

// ==========================
// FETCH WITH RETRY
// ==========================
async function fetchWithRetry(url, retries=3) {
  for (let i=0;i<retries;i++) {
    try {
      return await client.get(url);
    } catch (err) {
      if (i===retries-1) throw err;
      console.log("🔁 retry:", url);
      await delay(300);
    }
  }
}

// ==========================
// SITE HANDLERS
// ==========================
const SiteHandlers = {

  // ======================
  // DEFAULT HANDLER
  // ======================
  default: {
    articleSelectors: [
      "article",".movie-item",".post",".item",".anime-item",".-movie"
    ],
    episodeSelectors: [
      "ul#MVP li a",".episode-list a",".ep a",".episodes a",".mp-ep-btn"
    ],
    async getServers(epUrl) {
      const { data } = await fetchWithRetry(epUrl);
      const $ = cheerio.load(data);

      let servers = [];

      const main =
        $("div.mpIframe iframe").attr("data-src") ||
        $("div.mpIframe iframe").attr("src");

      if (main) servers.push({ name:"Main", url:main });

      $(".toolbar-item.mp-s-sl").each((i,el)=>{
        const name=$(el).find(".item-text").text().trim();
        const id=$(el).attr("data-id");
        if (id) servers.push({ name:name||`Player ${i+1}`, url:id });
      });

      return servers;
    }
  },

  // ======================
  // ANIME MASTERX
  // ======================
  "anime-masterx.com": {

    articleSelectors: [
  ".center_lnwphp"
],

    episodeSelectors: [
  "a[href*='-ep-']",
  "a[href*='/ep']",
  ".entry-content a[href*='ep']"
],
async getServers(epUrl){

  const { data } = await fetchWithRetry(epUrl)

  if(TEST_MODE){
    fs.writeFileSync("debug_ep.html", data)
  }

  console.log("EP HTML size:", data.length)

  let servers = []

  const match = data.match(/embed\/([0-9]+)/)

  if(!match){
    console.log("❌ embed id not found")
    return []
  }

  const id = match[1]

  console.log("🎬 embed id:", id)

  servers.push({
    name:"Main",
    url:`https://www.anime-masterx.com/embed/${id}&multi=link1`
  })

  servers.push({
    name:"Backup",
    url:`https://www.anime-masterx.com/embed/${id}&multi=link5`
  })

  return servers
}
}
};
// ==========================
// SELECT HANDLER
// ==========================
function getHandler(url) {
  const domain = getDomain(url);
  return SiteHandlers[domain] || SiteHandlers.default;
}

// ==========================
// GET LAST PAGE
// ==========================
async function getLastPage(categoryUrl){

  try{

    const { data } = await fetchWithRetry(categoryUrl)
    const $ = cheerio.load(data)

    let lastPage = 1

    $("a").each((i,el)=>{

      const href = $(el).attr("href")
      if(!href) return

      const match = href.match(/page\/(\d+)/)

      if(match){
        const p = parseInt(match[1])
        if(p > lastPage) lastPage = p
      }

      const match2 = href.match(/\?number=(\d+)/)

      if(match2){
        const p = parseInt(match2[1])
        if(p > lastPage) lastPage = p
      }

    })

    return lastPage

  }catch(e){

    return 1

  }

}

// ==========================
// AUTO DETECT HELPERS
// ==========================
function autoDetect($, selectors) {

  for (const sel of selectors) {

    const found = $(sel);

    if (found.length > 0) {

      console.log("🔍 ใช้ selector:", sel);

      return found;

    }

  }

  return $([]); // ⭐ แก้ตรงนี้

}

// ==========================
// MOJI EMBED → M3U8
// ==========================

async function extractM3U8(epUrl){

  try{

    const res = await client.get(epUrl)

    const html = res.data

    // หา m3u8 ใน script
    const match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/)

    if(match){
      return match[0]
    }

    return null

  }catch(e){

    return null

  }

}

function extractBasicInfo($, el) {

  const title =
    $(el).find(".title_movie").text().trim() ||
    $(el).find("a").text().trim();

  const link =
    $(el).find("a").attr("href");

  const image =
    $(el).find("img").attr("data-src") ||
    $(el).find("img").attr("src");

  return { title, link, image };

}

// ==========================
// FILE SIZE CONTROL
// ==========================

function commitProgress(message){
  try{

    execSync("git config user.name 'github-actions'");
    execSync("git config user.email 'actions@github.com'");

    execSync("git add data");

    try{
      execSync(`git commit -m "${message}"`);
    }catch{
      console.log("ไม่มีการเปลี่ยนแปลง");
      return;
    }

    execSync("git pull --rebase origin main");
    execSync("git push");

    console.log("🚀 pushed to github");

  }catch(err){
    console.log("⚠️ push error");
  }
}

// ==========================
// MAIN
// ==========================
(async()=>{

for(const cat of categories){

console.log("🎯 เริ่มหมวด:",cat.name)


if(!fs.existsSync("data")) fs.mkdirSync("data");

const JSON_DIR = "./data/json"

if(!fs.existsSync(JSON_DIR)){
  fs.mkdirSync(JSON_DIR,{recursive:true})
}

const progressFile = `${JSON_DIR}/${cat.slug}_progress.json`;

let startPage = 1;

if (fs.existsSync(progressFile)) {

  const saved = JSON.parse(fs.readFileSync(progressFile));
  startPage = saved.page || 1;

  console.log("🔁 Resume จากหน้า", startPage);

} else {

  // ⭐ เพิ่มตรงนี้
  fs.writeFileSync(
    progressFile,
    JSON.stringify({ page: 1 }, null, 2)
  );

  console.log("🆕 สร้าง progress ใหม่");

}

let currentData=[];
let currentFilePath=`${JSON_DIR}/${cat.slug}.json`;

const oldMap=new Map();

if (fs.existsSync(currentFilePath)) {
  try {
    currentData = JSON.parse(fs.readFileSync(currentFilePath));
  } catch {
    currentData = [];
  }
} else {
  currentData = [];
}

currentData.forEach(m=>{
  oldMap.set(m.link,m);
});

function saveData(){
  fs.writeFileSync(
    currentFilePath,
    JSON.stringify(currentData,null,2)
  );
}

const handler = getHandler(cat.url);
const lastPage = await getLastPage(cat.url)
console.log("📚 จำนวนหน้าทั้งหมด:", lastPage)

let finished = false;
let episodeCounter = 0;
let emptyPageCount = 0;

//save auto
const autoSave = setInterval(()=>{
  if(currentData.length > 0){
    fs.writeFileSync(
      currentFilePath,
      JSON.stringify(currentData,null,2)
    );
    console.log("💾 Auto save");
  }
}, 5*60*1000);

//LOOP

for (let page = startPage; page <= (TEST_MODE ? 1 : lastPage); page++) {
    
  let pageSuccess = false;

  try {

    let pageUrl;

if(page === 1){
  pageUrl = cat.url;
}else{
  pageUrl = `${cat.url}?number=${page}`;
}

pageUrl = fixCategoryUrl(pageUrl);

console.log("📄 หน้า", page);

  console.log("🌐 URL:", pageUrl);

const { data: catHtml } =
  await fetchWithRetry(pageUrl);
emptyPageCount = 0;
    
    const $cat = cheerio.load(catHtml);

    console.log("HTML size:", catHtml.length);
    console.log("center count:", $cat(".center_lnwphp").length);
    if(TEST_MODE){
fs.writeFileSync("debug_category.html", catHtml);
}
    
    const articles =
  autoDetect($cat, handler.articleSelectors).toArray();

console.log("article found:", articles.length);

    if (articles.length === 0) {

  emptyPageCount++;

  console.log(`ไม่มีข้อมูล หน้า ${page} (${emptyPageCount}/3)`);

  if (emptyPageCount >= 3) {

    console.log("หยุด scraper เพราะเจอหน้าว่าง 3 หน้า");

    finished = true;

    fs.writeFileSync(
      progressFile,
      JSON.stringify({ page: page })
    );

    break;
  }

  pageSuccess = true;
  continue;
}

emptyPageCount = 0;
    
     let animeCount = 0;
     for (const el of articles) {

      const basic = extractBasicInfo($cat, el);
      if (!basic.title) continue;
       
	animeCount++
	if(TEST_MODE && animeCount > 1) break
      
	const link = normalizeUrl(basic.link);
      	if (!link) continue;

      // ⭐ เพิ่มตรงนี้
let movie = oldMap.get(link);

if (movie && movie.episodes && movie.episodes.length > 0) {
  console.log("🔄 ตรวจ EP ใหม่:", movie.title);
}
  
      if (!movie) {
        movie = {
          title: basic.title,
          link,
          image: basic.image || "",
          episodes: []
        };

        currentData.push(movie);
        oldMap.set(link, movie);
        saveData();
      }

      const { data: detailHtml } =
        await fetchWithRetry(link);

      const $detail = cheerio.load(detailHtml);
	if(TEST_MODE){
fs.writeFileSync("debug_detail.html", detailHtml);
}
      const epElements =
        autoDetect($detail, handler.episodeSelectors).toArray();
	console.log("EP found:", epElements.length)
	let epCount = 0;

      for (const el2 of epElements) {

        const $a = $detail(el2);

        let epLink = normalizeUrl($a.attr("href"));
		if (!epLink) continue;

// กรองลิงก์ที่ไม่ใช่ตอน
if (
  epLink.includes("facebook.com") ||
  epLink.includes("#") ||
  epLink.includes("comment")
) continue;
	
	epCount++
	if(TEST_MODE && epCount > 1) break


        if (movie.episodes.find(x => x.link === epLink)) {

  		console.log("⛔ ตอนซ้ำ หยุดตรวจตอน");

  		break;

		}

        console.log("↳ ดึงตอน:", $a.text().trim());

        const siteHandler = getHandler(epLink);

        let servers = [];

        try {
          
servers = await siteHandler.getServers(epLink);

        } catch (err) {
          console.log("⚠️ server error:", epLink);
        }

        movie.episodes.push({
          name: $a.text().trim(),
          link: epLink,
          servers
        });

        episodeCounter++;

        saveData();

        if (episodeCounter % 50 === 0) {

          console.log("🚀 commit partial");

          commitProgress(
            `update ${cat.slug} episodes ${episodeCounter}`
          );
        }

        await randomDelay(120,300);
      }

    }

    pageSuccess = true;

  } 

catch (err) {

  console.log("❌ ERROR PAGE:", page);
  console.log(err.message);

  console.log("⚠️ ข้ามหน้า", page);

  emptyPageCount++;

  if (emptyPageCount >= 3) {

    console.log("หยุด scraper เพราะโหลดหน้าไม่ได้ 3 หน้า");

    finished = true;

    break;
  }

}

  if (pageSuccess) {

    saveData();

    commitProgress(
      `update ${cat.slug} page ${page}`
    );

    fs.writeFileSync(
      progressFile,
      JSON.stringify({ page: page + 1 })
    );

    console.log("💾 บันทึก progress:", page + 1);

  }

  await randomDelay(300,600);
}

if(currentData.length>0){
  fs.writeFileSync(currentFilePath,
    JSON.stringify(currentData,null,2));
}
if (finished) {
  console.log("SCRAPER_STATUS:FINISHED");
} else {
  console.log("SCRAPER_STATUS:IN_PROGRESS");
}
console.log("✅ เสร็จหมวด:",cat.name);

// ==========================
// BUILD M3U
// ==========================
try{

const DATA_DIR = "./data/json"
const PLAYLIST_DIR = "./data/playlist"

if(!fs.existsSync(PLAYLIST_DIR)){
  fs.mkdirSync(PLAYLIST_DIR)
}

const file = `${cat.slug}.json`
const files = [file]

for(const file of files){

  const category = file.replace(".json","")

  console.log("📂 build m3u:", category)

  const data = JSON.parse(
    fs.readFileSync(`${DATA_DIR}/${file}`)
  )

  let m3u = "#EXTM3U\n\n"

  for(const anime of data){

    for(const ep of anime.episodes){

      if(!ep.servers || ep.servers.length===0) continue

      let stream = ep.servers[0].url

          
      if(stream && !stream.includes(".m3u8") && !stream.includes("/qualitys/")){

        try{

          const res = await client.get(stream,{
            headers:{
              Referer: ep.link,
              "User-Agent":"Mozilla/5.0"
            }
          })

          const match =
            res.data.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/)

          if(match) stream = match[0]

        }catch{}

      }

      if(!stream) continue

      const logo = anime.image || ""

      const name =
        `${anime.title} ${ep.name.replace(anime.title,"")}`

      const tvgId =
        (category + "_" + anime.title)
        .toLowerCase()
        .replace(/[^a-z0-9]/g,"")

      m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${name}" tvg-logo="${logo}" group-title="${category}",${name}\n`
      m3u += `${stream}\n\n`

    }

  }

  fs.writeFileSync(`${PLAYLIST_DIR}/${category}.m3u`, m3u)

  console.log(`✅ playlist created: ${PLAYLIST_DIR}/${category}.m3u`)

}

}catch(e){

console.log("⚠️ build m3u error")
console.log(e)

}
clearInterval(autoSave);
}
process.exit(0);


})();




