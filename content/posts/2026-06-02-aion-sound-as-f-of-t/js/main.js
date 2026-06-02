import AionHost from "./aion-host.js"

const startBtns = document.querySelectorAll("input[type=button][value='▶']")
const stopBtns = document.querySelectorAll("input[type=button][value='⏹']")
const codes = document.querySelectorAll('code');

const host = new AionHost({
  onError: msg => console.error(`error: ${msg}`),
  onCompiled: () => console.log(host.state === "running" ? "running" : "compiled"),
})

function findPrecedingCode(refNode) {
  for (let i = codes.length - 1; i >= 0; i--) {
    const node = codes[i]
    const position = refNode.compareDocumentPosition(node)
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return node
    }
  }
  return null
}

startBtns.forEach(btn => btn.addEventListener("click", async () => {
  try {
    const code = findPrecedingCode(btn)
    if (code) await host.start(code.textContent)
    else console.error("can't find code")
  } catch (err) {
    console.error(String(err))
  }
}))

stopBtns.forEach(btn => btn.addEventListener("click", async () => {
  await host.stop()
}))