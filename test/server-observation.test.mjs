import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {once} from "node:events";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

async function withServer({secret = "", writer = "", history = ""} = {}, run) {
  const dir = await mkdtemp(join(tmpdir(), "pricing-receiver-"));
  const path = join(dir, "observations.jsonl");
  if (history) await writeFile(path, history);
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const child = spawn(process.execPath, [resolve("scripts/server.mjs")], {
    cwd:resolve("."),stdio:["ignore","pipe","pipe"],
    env:{...process.env, HOST:"127.0.0.1", PORT:String(port),
      PRICE_OBSERVATIONS_PATH:path, PRICE_OBSERVATION_WRITE_TOKEN:secret,
      PRICE_OBSERVATION_WRITER:writer},
  });
  let log = "";
  try {
    await new Promise((done, fail) => {
      const timeout = setTimeout(() => fail(new Error("pricing server startup timeout: " + log)), 8000);
      const started = chunk => {
        log += chunk.toString();
        if (log.includes("http://127.0.0.1:" + port)) {
          clearTimeout(timeout);
          child.off("exit", exited);
          done();
        }
      };
      const exited = code => {
        clearTimeout(timeout);
        fail(new Error("pricing server exited " + code + ": " + log));
      };
      child.stdout.on("data", started);
      child.stderr.on("data", chunk => {log += chunk.toString();});
      child.once("exit",exited);
    });
    await run({url:"http://127.0.0.1:" + port, path});
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
    await rm(dir, {recursive:true,force:true});
  }
}
const source = "ni:///sha-256;" + "A".repeat(43);
const observation = {
  observationId:"receiving:1", provider:"provider:p", taskClass:"audit",
  outcome:"verified",evidenceRef:source,
};
const rank = {
  taskClass:"audit",
  offers:[{provider:"provider:p",consideration:{kind:"credit",asset:"urn:561:test",unit:"credit",amount:5}}],
};
const post = (base, path, body, headers = {}) => fetch(base + path, {
  method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body),
});
test("unconfigured writer cannot claim verified outcomes", async () => {
  await withServer({}, async ({url,path}) => {
    const response = await post(url,"/observe",observation);
    assert.equal(response.status,503);
    assert.equal((await response.json()).refusal.code,"observation-writer-not-configured");
    await assert.rejects(readFile(path,"utf8"),{code:"ENOENT"});
    const rankResponse = await post(url,"/rank",{...rank, observations:[
      {...observation,outcome:"verified"}]});
    assert.equal(rankResponse.status,400);
    assert.equal((await rankResponse.json()).refusal.code,"caller-observation-history-not-authoritative");
  });
});

test("protected observation claims, exact replay and server-owned ranking history", async () => {
  const secret = "s".repeat(64);
  await withServer({secret,writer:"office:receiving"}, async ({url,path}) => {
    assert.equal((await post(url,"/observe",observation)).status,401);
    assert.equal((await post(url,"/observe",observation,{authorization:"Bearer wrong"})).status,401);
    const header={authorization:"Bearer " + secret};
    const first = await post(url,"/observe",observation,header);
    assert.equal(first.status,201);
    const firstRecord=(await first.json()).observation;
    assert.equal(firstRecord.observedBy,"office:receiving");
    assert.equal(firstRecord.assurance,"authenticated-writer-claim-not-independent-ACK-or-ATT");
    assert.equal("ack" in firstRecord,false);
    const replay=await post(url,"/observe",observation,header);
    assert.equal(replay.status,200);
    assert.equal((await replay.json()).replay,true);
    assert.equal((await post(url,"/observe",{...observation,outcome:"refused"},header)).status,400);
    assert.equal((await post(url,"/observe",{...observation,observedBy:"self"},header)).status,400);
    const response=await post(url,"/rank",rank);
    assert.equal(response.status,200);
    const report=await response.json();
    assert.equal(report.assurance,"authenticated-writer-claims-only-not-independent-ACK-or-ATT");
    assert.deepEqual(report.result.ranked[0].observations,{verified:1,total:1});
    assert.equal((await readFile(path,"utf8")).trim().split("\n").length,1);
  });
});

test("legacy unreceipted history cannot masquerade as the authoritative sample", async () => {
  const legacy=JSON.stringify({provider:"provider:p",taskClass:"audit",outcome:"verified"})+"\n";
  await withServer({history:legacy},async ({url}) => {
    const response=await post(url,"/rank",rank);
    assert.equal(response.status,400);
    assert.match((await response.json()).refusal.message,/authenticated-claim format/);
  });
});
