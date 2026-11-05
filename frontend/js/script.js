
const DEPLOYED_API = "https://almaguer-william-a2.onrender.com";
const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8000"
  : DEPLOYED_API;

const CORE = ["King", "Pierce", "Snohomish"];


const state = {
  years: null,      // [from, to] year_bin range, or null = all years
  county: null,     // selected county
  make: null,       // selected make
  evType: "ALL",    // "ALL" | "BEV" | "PHEV"
};

let cube = [];      // /api/cube rows: {county, year_bin, make_group, ev_type, n}
let geo = null;     // /api/geo TopoJSON
let cities = [];    // /api/cities rows for the current selection (fetched from the server)
let models = [];    // /api/models rows for the selected make (fetched from the server)

function setState(changes) {
  Object.assign(state, changes);
  render();
}

function filtered(ignore = []) {
  return cube.filter(d =>
    (ignore.includes("years")  || !state.years  || (d.year_bin >= state.years[0] && d.year_bin <= state.years[1])) &&
    (ignore.includes("county") || !state.county || d.county === state.county) &&
    (ignore.includes("make")   || !state.make   || d.make_group === state.make) &&
    (ignore.includes("evType") || state.evType === "ALL" || d.ev_type === state.evType)
  );
}

const sumBy = (rows, key) => d3.rollups(rows, v => d3.sum(v, d => d.n), d => d[key]);
const yearLabel = y => (y === 2010 ? "Pre-2011" : String(y));
const fmt = d3.format(",");
const short = (s, n = 14) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

let makeColor = () => "#3b82f6";
function initColors() {
  const makes = sumBy(cube, "make_group").sort((a, b) => b[1] - a[1])
    .map(d => d[0]).filter(m => m !== "OTHER");
  makeColor = d3.scaleOrdinal([...makes, "OTHER"], [...d3.schemeTableau10, "#9ca3af"]);
}

const tooltip = d3.select("#tooltip");
function showTooltip(event,html){
  const pad = 12, box = tooltip.html(html).style("display","block").node().getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if(x + box.width > window.innerWidth) x = event.clientX - box.width - pad;
  if(y + box.height > window.innerHeight) y = event.clientY - box.height - pad;
  tooltip.style("left", x + "px").style("top", y + "px");
}
const hideTooltip = () => tooltip.style("display","none");

function chartFrame(selector, margin){
  const svg = d3.select(selector)
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const size = () => [
    svg.node().clientWidth - margin.left - margin.right,
    svg.node().clientHeight - margin.top - margin.bottom
  ];
  return {svg, g, size};
}

function emptyState(g,isEmpty,w,h, msg = "No vehicles matching this selection"){
  g.selectAll("text.empty").data(isEmpty ? [msg] : []).join("text")
    .attr("class","empty")
    .attr("x", w/2).attr("y", h/2)
    .attr("text-anchor","middle")
    .text(d => d);
}

function debounce(func, ms){
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), ms);
  }
}

function queryString(params){
  const p = new URLSearchParams();
  for(const [k,v] of Object.entries(params))
    if(v != null && v !== "ALL") p.set(k, v);
  return p.toString();
}

const setLoading = (ids,on) => ids.forEach(id => d3.select(id).classed("loading",on));

let firstdraw = true;
const duration = () => (firstdraw ? 700 : 300);
const stagger = n => (firstdraw ? Math.min(40,1000/ Math.max(n,1)): 0);

//View 1: EVs by makes to then models
const makeChart = (() => {
  const margin = { top: 10, right: 10, bottom: 85, left: 50 };
  const { g, size } = chartFrame("#makes", margin);
  const xAxis = g.append("g"), yAxis = g.append("g"), bars = g.append("g");
  const xLabel = g.append("text").attr("class", "axis-label").attr("text-anchor","middle")
  const yLabel = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)").text("Vehicles");
  d3.select("#makes-back").on("click", () => setState({ make: null }));

  function update(){
    const [w, h] = size();
    let data;
    if (!state.make) {
      data = sumBy(filtered(["make"]), "make_group")
        .map(([make, n]) => ({ key: make, label: make, make, n }))
        .sort((a, b) => (a.key === "OTHER") - (b.key === "OTHER") || b.n - a.n); 
      d3.select("#makes-title").text("EVs by make");
      d3.select("#makes-back").style("display", "none");
    } else {
      data = models.map(d => ({
        key: `${d.make} ${d.model}`,
        label: state.make === "OTHER" ? `${d.make} ${d.model}` : d.model,
        make: state.make, n: d.n,
      }));
      d3.select("#makes-title").text(`${state.make === "OTHER" ? "Other makes" : state.make}: top models`);
      d3.select("#makes-back").style("display", "inline-block");
    }

    const x = d3.scaleBand().domain(data.map(d => d.key)).range([0, w]).padding(0.15);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.n) || 1]).nice().range([h, 0]);
    const labelOf = new Map(data.map(d => [d.key, d.label]));

    xAxis.attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickFormat(k => short(labelOf.get(k) || k)))
      .selectAll("text").attr("transform", "rotate(-40)").style("text-anchor", "end")
      .attr("dx", "-0.5em").attr("dy", "0.3em");
    yAxis.transition().duration(300).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s")));
    yLabel.attr("x", -h / 2).attr("y", -38);
    xLabel.attr("x", w/2).attr("y", h + 78).text(state.make ?  "Model" : "Make");
    const step = stagger(data.length);
    bars.selectAll("rect")
      .data(data, d => d.key)
      .join(enter => enter.append("rect").attr("x", d => x(d.key)).attr("y", h).attr("height", 0))
        .attr("fill", d => makeColor(d.make))
        .style("cursor", state.make ? "default" : "pointer")
        .on("mouseenter", (e, d) => bars.selectAll("rect").attr("opacity", o => (o.key === d.key ? 1 : 0.45)))
        .on("mousemove", (e, d) => showTooltip(e, `<b>${d.label}</b><br>${fmt(d.n)} vehicles`))
        .on("mouseleave", () => { bars.selectAll("rect").attr("opacity", 1); hideTooltip(); })
        .on("click", (e, d) => { if (!state.make) { hideTooltip(); models = []; setState({ make: d.make }); } })
      .transition().duration(duration()).delay((d,i) => i * step).ease(d3.easeCubicOut)
        .attr("x", d => x(d.key))
        .attr("width", x.bandwidth())
        .attr("y", d => y(d.n))
        .attr("height", d => h - y(d.n));

    emptyState(g, data.length === 0, w, h, state.make && !modelsLoaded ? "Loading…" : undefined);
  }

  return { update };
})();

//View 2: EVs by Model Year
const yearChart = (() => {
  const margin = { top: 10, right: 10, bottom: 50, left: 50 };
  const { g, size } = chartFrame("#modelYear", margin);
  const xAxis = g.append("g"), yAxis = g.append("g"), bars = g.append("g"), brushG = g.append("g");
  const xLabel = g.append("text").attr("class", "axis-label").attr("text-anchor","middle")
    .text("Model year");
  const yLabel = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)").text("Vehicles");
  
  let x = d3.scaleBand(), years = [], byYear = new Map(), frame= "";

  const yearsIn = ([prevFrom,prevTo]) => years.filter(yr => {
    const c = x(yr) + x.bandwidth()/2;
    return c >= prevFrom && c <= prevTo;
  });

  const brush = d3.brushX().on("brush end", ({selection, sourceEvent}) => {
    if(!sourceEvent) return; // ignore programmatic changes
    const inside = selection ? yearsIn(selection) : [];
    setState({ years: inside.length ? [d3.min(inside), d3.max(inside)] : null });
  });

  brushG.on("mousemove.tooltip", event => {
      const [px] = d3.pointer(event,g.node());
      const yr = years.find(v => px >= x(v) && px <= x(v) + x.bandwidth());
      if(yr === undefined) return hideTooltip();
      showTooltip(event, `<b>${yearLabel(yr)}</b><br>${fmt(byYear.get(yr) || 0)} vehicles`);
  }).on("mouseleave.tooltip", hideTooltip);

  function update() {
    const [w, h] = size();
    byYear = new Map(sumBy(filtered(["years"]), "year_bin"));   // all years stay visible
    years = d3.range(d3.min(cube, d => d.year_bin), d3.max(cube, d => d.year_bin) + 1);

    x.domain(years).range([0, w]).padding(0.15);
    const y = d3.scaleLinear().domain([0, d3.max(byYear.values()) || 1]).nice().range([h, 0]);

    xAxis.attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).tickFormat(yearLabel))
      .selectAll("text").attr("transform", "rotate(-45)").style("text-anchor", "end")
      .attr("dx", "-0.5em").attr("dy", "0.3em");
    yAxis.transition().duration(300).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s")));
    xLabel.attr("x", w / 2).attr("y", h + 48);
    yLabel.attr("x", -h / 2).attr("y", -38);

    const inRange = yr => !state.years || (yr >= state.years[0] && yr <= state.years[1]);
    const fill = state.make ? makeColor(state.make) : "#3b82f6"; 
    const step = stagger(years.length);
    bars.selectAll("rect")
      .data(years, d => d)                          
      .join(enter => enter.append("rect").attr("y",h).attr("height",0).attr("fill",fill))
        .attr("x",d=> x(d))
        .attr("width", x.bandwidth())
      .transition().duration(duration()).delay((d,i) => i * step).ease(d3.easeCubicOut)
        .attr("fill", d => (inRange(d) ? fill : "#cbd5e1"))
        .attr("y", d => y(byYear.get(d) || 0))
        .attr("height", d => h - y(byYear.get(d) || 0));

  
    if (frame !== `${w}x${h}`) {
      frame = `${w}x${h}`;
      brush.extent([[0, 0], [w, h]]);
      brushG.call(brush);
      brushG.select(".overlay").style("cursor", "crosshair");
    }
    if (!state.years) brushG.call(brush.move, null);  
    emptyState(g, byYear.size === 0, w, h);
  }

  return { update };
})();

//View 3: EVs by County then to Cities of Selected County
const countyChart = (() => {
  const margin = { top: 4, right: 52, bottom: 34, left: 115 };
  const { g, size } = chartFrame("#counties", margin);
  const xAxis = g.append("g"), yAxis = g.append("g"), bars = g.append("g"), labels = g.append("g");
  const xLabel = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle").text("Vehicles");
  const yLabel = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle").attr("transform", "rotate(-90)");
  d3.select("#counties-back").on("click", () => setState({ county: null }));

  function update() {
    const [w, h] = size();
    let data;
    if (!state.county) {
      data = sumBy(filtered(["county"]), "county")
        .map(([county, n]) => ({ key: county, label: county, county, n }))
        .sort((a, b) => b.n - a.n);
      d3.select("#counties-title").text("EVs by county");
      d3.select("#counties-back").style("display", "none");
    } else {
      data = cities.filter(c => c.county === state.county).slice(0, 15)
        .map(c => ({ key: c.city, label: c.city, county: c.county, n: c.n }));
      d3.select("#counties-title").text(`${state.county} County: top cities`);
      d3.select("#counties-back").style("display", "inline-block");
    }

    const barsH = data.length ? Math.min(h, data.length * 28) : h;
    const y = d3.scaleBand().domain(data.map(d => d.key)).range([0, barsH]).padding(0.15);
    const x = d3.scaleLinear().domain([0, d3.max(data, d => d.n) || 1]).nice().range([0, w]);

    yAxis.call(d3.axisLeft(y).tickSize(0).tickPadding(6).tickFormat(k => short(k, 15)));
    xAxis.transition().duration(300).attr("transform", `translate(0,${barsH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")));
    xLabel.attr("x", w / 2).attr("y", barsH + 30);
    yLabel.attr("x", -barsH / 2).attr("y", -102).text(state.county ? "City" : "County");
    const step = stagger(data.length);
    const fill = state.make ? makeColor(state.make) : "#1e3a8a";
    bars.selectAll("rect")
      .data(data, d => d.key)
      .join(enter => enter.append("rect").attr("x", 0).attr("width", 0).attr("y", d => y(d.key)))
        .attr("fill", d => (CORE.includes(d.county) || state.county ? fill : d3.color(fill).brighter(1.2)))
        .style("cursor", state.county ? "default" : "pointer")
        .on("mouseenter", (e, d) => bars.selectAll("rect").attr("opacity", o => (o.key === d.key ? 1 : 0.45)))
        .on("mousemove", (e, d) => showTooltip(e, `<b>${d.label}</b><br>${fmt(d.n)} vehicles`))
        .on("mouseleave", () => { bars.selectAll("rect").attr("opacity", 1); hideTooltip(); })
        .on("click", (e, d) => { if (!state.county) { hideTooltip(); setState({ county: d.county }); } })
      .transition().duration(duration()).delay((d, i) => i * step).ease(d3.easeCubicOut)
        .attr("y", d => y(d.key))
        .attr("height", y.bandwidth())
        .attr("width", d => x(d.n));

    
    labels.selectAll("text")
      .data(data, d => d.key)
      .join(enter => enter.append("text").attr("opacity", 0))
        .attr("class", "value-label")
        .attr("dy", "0.35em")
        .text(d => fmt(d.n))
      .transition().duration(duration()).delay((d, i) => i * step).ease(d3.easeCubicOut)
        .attr("x", d => x(d.n) + 4)
        .attr("y", d => y(d.key) + y.bandwidth() / 2)
        .attr("opacity", 1);

    emptyState(g, data.length === 0, w, h);
  }

  return { update };
})();

//View 4(Main View): MAP
const mapView= (() => {
  const svg = d3.select("#map"), g = svg.append("g");
  const countiesG = g.append("g")
  const citiesG = g.append("g");
  let features = [], projection, path, k = 1, lastCounty = null, frame = "";
  const arrowLen = d3.scaleSqrt().range([0, 34]);

  const arrowShape = len => {
    const head = Math.min(5, len * 0.45), w = head * 0.6;
    return `M0,0H${len - head}M${len},0L${len - head},${-w}L${len - head},${w}Z`;
  };

  const arrowTransform = d =>
    `translate(${projection([d.lon, d.lat])}) scale(${1 / Math.sqrt(k)}) rotate(-35)`;

    const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", event => {
    g.attr("transform", event.transform);
    k = event.transform.k;
    countiesG.selectAll("path").attr("stroke-width", d => (d.properties.name === state.county ? 2 : 0.6) / k);
    citiesG.selectAll("path").attr("transform", arrowTransform);
  });
  svg.call(zoom).on("dblclick.zoom", null);

    function zoomTo(feature) {
    const width = svg.node().clientWidth, height = svg.node().clientHeight;
    if (!feature) return svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    const scale = Math.min(12, 0.85 / Math.max((x1 - x0) / width, (y1 - y0) / height));
    svg.transition().duration(750).call(zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(scale)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  function legend(color, max) {
    const stops = [1, 10, 100, 1000, 10000, 100000].filter(v => v <= max);
    const el = d3.select("#map-legend").html("");
    el.append("span").text("EVs per county:");
    stops.forEach(v => {
      el.append("span").attr("class", "swatch").style("background", color(v));
      el.append("span").text(d3.format("~s")(v));
    });
    el.append("svg").attr("class", "legend-arrow").attr("width", 24).attr("height", 16)
      .append("path").attr("class", "city").attr("transform", "translate(3,13) rotate(-35)").attr("d", arrowShape(19));
    el.append("span").text("city (arrow length = EVs)");
  }

  function update() {
    if (!geo) return;
    const width = svg.node().clientWidth, height = svg.node().clientHeight;
    if (!features.length) features = topojson.feature(geo, geo.objects.counties).features;
    if (frame !== `${width}x${height}`) {
      frame = `${width}x${height}`;
      projection = d3.geoConicConformal().rotate([120.5, 0]).parallels([45.8, 48.7])
        .fitSize([width, height], { type: "FeatureCollection", features });
      path = d3.geoPath(projection);
    }

    const counts = new Map(sumBy(filtered(["county"]), "county"));
    const max = d3.max(counts.values()) || 1;
    const color = d3.scaleSequentialLog(d3.interpolateBlues).domain([1, Math.max(max, 10)]);

    countiesG.selectAll("path")
      .data(features, d => d.id)
      .join("path")
        .attr("class", d => `county ${d.properties.name === state.county ? "selected" : ""}`)
        .attr("d", path)
        .attr("stroke-width", d => (d.properties.name === state.county ? 2 : 0.6) / k)
        .style("cursor", "pointer")
        .on("mousemove", (e, d) => {
          const n = counts.get(d.properties.name) || 0;
          showTooltip(e, `<b>${d.properties.name} County</b><br>${fmt(n)} vehicles` +
            (CORE.includes(d.properties.name) ? "<br><i>dense core</i>" : ""));
        })
        .on("mouseleave", hideTooltip)
        .on("click", (e, d) => setState({ county: state.county === d.properties.name ? null : d.properties.name }))
      .transition().duration(300)
        .attr("fill", d => { const n = counts.get(d.properties.name) || 0; return n ? color(n) : "#f1f5f9"; });
    countiesG.selectAll("path.selected").raise();
    legend(color, max);

    updateCities();
    if(state.county !== lastCounty) { 
      zoomTo(features.find(f => f.properties.name === state.county)); 
      lastCounty = state.county; 
    }
  }

  function updateCities() {
    if (!projection) return;
    const pts = cities.filter(c => c.lon != null && c.lat != null);
    arrowLen.domain([0, d3.max(pts, d => d.n) || 1]);
    citiesG.selectAll("path")
      .data(pts, d => `${d.county}|${d.city}`)
      .join(enter => enter.append("path").attr("class", "city").attr("d", arrowShape(0)))
        .attr("transform", arrowTransform)
        .on("mousemove", (e, d) => showTooltip(e, `<b>${d.city}</b> (${d.county})<br>${fmt(d.n)} vehicles`))
        .on("mouseleave", hideTooltip)
        .on("click", (e, d) => setState({ county: d.county }))
      .order()                                         // biggest first, so small arrows stay on top
      .transition().duration(300)
        .attr("d", d => arrowShape(arrowLen(d.n)));
  }

  return { update, updateCities };
})();

//server-backed data
// Coarse queries go to the server, debounced so brushing doesn't send too many requests.
let citiesKey = null, citiesSeq = 0;
const loadCities = debounce(async () => {
  const q = queryString({ make: state.make, ev_type: state.evType,year_min: state.years?.[0], year_max: state.years?.[1] });
  if (q === citiesKey) return;   
  citiesKey = q;
  const seq = ++citiesSeq;
  setLoading(["#map-view", "#counties-view"], true);
  try {
    const data = await d3.json(`${API_BASE}/api/cities?${q}`);
    if (seq !== citiesSeq) return;
    cities = data;
    countyChart.update();
    mapView.updateCities();
  } catch (err) {
    console.error(err);
    citiesKey = null;
  } finally {
    if (seq === citiesSeq) setLoading(["#map-view", "#counties-view"], false);
  }
}, 150);

let modelsKey = null, modelsSeq = 0, modelsLoaded = false;
const loadModels = debounce(async () => {
  if (!state.make) return;
  const q = queryString({ make: state.make, county: state.county, ev_type: state.evType, year_min: state.years?.[0], year_max: state.years?.[1] });
  if (q === modelsKey) return;
  modelsKey = q;
  modelsLoaded = false;
  const seq = ++modelsSeq;
  setLoading(["#makes-view"], true);
  try {
    const data = await d3.json(`${API_BASE}/api/models?${q}`);
    if (seq !== modelsSeq || !state.make) return;
    models = data;
    modelsLoaded = true;
    makeChart.update();
  } catch (err) {
    console.error(err);
    modelsKey = null;
  } finally {
    if (seq === modelsSeq) setLoading(["#makes-view"], false);
  }
}, 150);

//selection
function renderSelection() {
  const chips = [];
  if (state.years) chips.push({ key: "years", label: state.years[0] === state.years[1]
    ? `Year: ${yearLabel(state.years[0])}`
    : `Years: ${yearLabel(state.years[0])}–${yearLabel(state.years[1])}` });
  if (state.county) chips.push({ key: "county", label: `County: ${state.county}` });
  if (state.make) chips.push({ key: "make", label: `Make: ${state.make}` });
  if (state.evType !== "ALL") chips.push({ key: "evType", label: `Type: ${state.evType}` });

  d3.select("#chips").selectAll(".chip")
    .data(chips, d => d.key)
    .join("span")
      .attr("class", "chip")
      .text(d => `${d.label} ✕`)
      .on("click", (_, d) => setState({ [d.key]: d.key === "evType" ? "ALL" : null }));

  d3.selectAll("#type-toggle button").classed("active", function () {
    return this.dataset.type === state.evType;
  });

  const total = d3.sum(cube, d => d.n);
  const rows = filtered();
  const shown = d3.sum(rows, d => d.n);
  const outside = d3.sum(rows.filter(d => !CORE.includes(d.county)), d => d.n);
  d3.select("#summary").text(shown
    ? `Showing ${fmt(shown)} of ${fmt(total)} vehicles · ${(outside / shown * 100).toFixed(1)}% outside King, Pierce & Snohomish`
    : "No vehicles match this selection.");
}

//render loop
function render() {
  renderSelection();
  yearChart.update();
  makeChart.update();
  countyChart.update();
  mapView.update();
  loadCities();
  if (state.make) loadModels(); else { modelsKey = null; }
}

d3.select("#reset").on("click", () => setState({ years: null, county: null, make: null, evType: "ALL" }));
d3.selectAll("#type-toggle button").on("click", function () { setState({ evType: this.dataset.type }); });
window.addEventListener("resize", debounce(render, 150));

//start
async function main() {
  try {
    [cube, geo] = await Promise.all([
      d3.json(`${API_BASE}/api/cube`),
      d3.json(`${API_BASE}/api/geo`),
    ]);
    console.log("cube rows:", cube.length);
    initColors();
    render();
    firstdraw = false;
  } catch (err) {
    console.error(err);
    d3.select("#summary").text(
      `Could not reach the API at ${API_BASE}. Locally: is uvicorn running on port 8000? ` +
      "Deployed: the free server may be waking up, so wait a minute and reload.");
  }
}
main();
