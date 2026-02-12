// server.js
// npm install express

import express from "express"

const app = express()
app.use(express.json())

// ======================
// SLOT ENGINE
// ======================

const GRID_COLS = 6
const GRID_ROWS = 5
const MAX_PAYOUT_MULTIPLIER = 21000

const LOW_TIER = ["🍌","🍋","🍍"]

const ITEMS_NORMAL = {
  "🍎":12,"🍇":15,"🍉":15,"🍑":16,"🍒":17,"🍬":11,"🍭":2,"🍌":3,"🍋":3,"🍍":3
}

const ITEMS_BONUS = {
  "🍎":22,"🍇":24,"🍉":24,"🍑":24,"🍒":25,"🍬":16,"🍭":0,"🍌":2,"🍋":4,"🍍":2
}

const PAYTABLE = {
  "🍬":{8:4,10:10,12:20},
  "🍎":{8:1.5,10:5,12:10},
  "🍇":{8:0.8,10:4,12:8},
  "🍉":{8:0.5,10:3,12:5},
  "🍑":{8:0.4,10:2,12:4},
  "🍒":{8:0.25,10:1,12:2}
}

const BOMB_WEIGHTS={2:400,5:250,10:120,25:40,50:8,100:2}

// ---------- utils ----------
function weightedRandom(weights){
  const total=Object.values(weights).reduce((a,b)=>a+b,0)
  let r=Math.random()*total
  for(const k in weights){
    r-=weights[k]
    if(r<=0) return k
  }
}

function getVolatility(balance,bet){
  const ratio=balance/bet
  if(ratio>1000) return 0.38
  if(ratio<50) return 0.07
  return 0.18
}

function generateSymbol(isBonus,dead){
  if(dead) return LOW_TIER[Math.floor(Math.random()*3)]
  return weightedRandom(isBonus?ITEMS_BONUS:ITEMS_NORMAL)
}

function generateGrid(isBonus,dead){
  return Array.from({length:GRID_ROWS},()=>
    Array.from({length:GRID_COLS},()=>generateSymbol(isBonus,dead))
  )
}

function countSymbols(grid){
  const map={}
  grid.flat().forEach(s=>map[s]=(map[s]||0)+1)
  return map
}

function getPayout(symbol,count,bet){
  if(count<8) return 0

  if(LOW_TIER.includes(symbol)) return bet*0.2

  const table=PAYTABLE[symbol]
  if(!table) return 0

  if(count>=12) return bet*table[12]
  if(count>=10) return bet*table[10]
  return bet*table[8]
}

function removeWinning(grid,winners){
  return grid.map(r=>r.map(c=>winners.includes(c)?null:c))
}

function tumble(grid,isBonus){
  const g=grid.map(r=>[...r])

  for(let c=0;c<GRID_COLS;c++){
    let stack=[]
    for(let r=GRID_ROWS-1;r>=0;r--){
      if(g[r][c]) stack.push(g[r][c])
    }
    for(let r=GRID_ROWS-1;r>=0;r--){
      g[r][c]=stack.shift()||generateSymbol(isBonus,false)
    }
  }
  return g
}

function rollBomb(){
  return Number(weightedRandom(BOMB_WEIGHTS))
}

// ---------- spin ----------
function spin({balance,bet,isBonus=false}){
  const vol=getVolatility(balance,bet)
  const dead=Math.random()<vol

  let grid=generateGrid(isBonus,dead)
  let totalWin=0
  let totalMult=1
  let history=[]

  while(true){
    const counts=countSymbols(grid)
    const winners=Object.keys(counts).filter(s=>counts[s]>=8)
    if(!winners.length) break

    let win=0
    winners.forEach(s=>{
      win+=getPayout(s,counts[s],bet)
    })

    let bomb=0
    if(isBonus&&Math.random()<0.4){
      bomb=rollBomb()
      totalMult+=bomb
    }

    win*=totalMult
    totalWin+=win

    history.push({grid,winners,bomb,win})
    grid=tumble(removeWinning(grid,winners),isBonus)
  }

  totalWin=Math.min(totalWin,bet*MAX_PAYOUT_MULTIPLIER)

  const scatter=(countSymbols(grid)["🍭"]||0)
  const bonusTriggered=!isBonus&&scatter>=4

  return {grid,totalWin,tumbleHistory:history,bonusTriggered}
}

// ======================
// API
// ======================

app.post("/spin",(req,res)=>{
  res.json(spin(req.body))
})

// ======================
// FRONTEND (React inside)
// ======================

app.get("/",(req,res)=>{
res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Sweet Bonanza TMA</title>

<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/framer-motion/dist/framer-motion.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js"></script>

<style>
body{
background:linear-gradient(180deg,#66ccff,#ff66cc);
}
.gridbg{
background:rgba(123,92,255,0.35);
backdrop-filter:blur(10px);
}
</style>
</head>

<body class="min-h-screen flex items-center justify-center">

<div id="root"></div>

<script>

const {useState,useEffect}=React
const {motion,AnimatePresence}=window["framer-motion"]

const COLS=6
const ROWS=5

function emptyGrid(){
 return Array.from({length:ROWS},()=>
  Array.from({length:COLS},()=>"🍬"))
}

function App(){
 const [grid,setGrid]=useState(emptyGrid())
 const [balance,setBalance]=useState(10000)
 const [bet,setBet]=useState(10)
 const [freeSpins,setFreeSpins]=useState(0)
 const [spinning,setSpinning]=useState(false)

 const tg=window.Telegram?.WebApp

 useEffect(()=>{
  tg?.ready()
  tg?.expand()
  tg?.setHeaderColor("#ff66cc")
 },[])

 async function spinGame(){
  if(spinning) return
  setSpinning(true)

  const res=await fetch("/spin",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({
    balance,
    bet,
    isBonus:freeSpins>0
   })
  })

  const data=await res.json()

  for(const step of data.tumbleHistory){
    setGrid(step.grid)
    if(step.win>0)
      tg?.HapticFeedback?.impactOccurred("medium")
    await new Promise(r=>setTimeout(r,600))
  }

  setGrid(data.grid)
  setBalance(b=>b-bet+data.totalWin)

  if(data.bonusTriggered){
    setFreeSpins(10)
    tg?.HapticFeedback?.notificationOccurred("success")
  }

  if(freeSpins>0) setFreeSpins(f=>f-1)
  setSpinning(false)
 }

 async function buyBonus(){
  const cost=bet*100
  if(balance<cost) return alert("Not enough balance")
  setBalance(b=>b-cost)
  setFreeSpins(10)
 }

 return React.createElement("div",{className:"text-center"},

  React.createElement("div",{className:"gridbg p-4 rounded-2xl shadow-xl"},

   React.createElement("div",{className:"grid grid-cols-6 gap-2"},
    grid.flatMap((row,r)=>
     row.map((s,c)=>
      React.createElement(motion.div,{
       key:r+"-"+c+"-"+s,
       initial:{y:-50,scale:0.7,opacity:0},
       animate:{y:0,scale:1,opacity:1},
       exit:{scale:1.5,opacity:0},
       transition:{duration:0.4},
       className:"w-16 h-16 flex items-center justify-center text-3xl bg-white/20 rounded-xl"
      },s)
     )
    )
   )
  ),

  React.createElement("div",{className:"mt-6 space-x-3"},
   React.createElement("button",{onClick:spinGame,className:"px-6 py-3 bg-pink-500 text-white rounded-xl"},"SPIN"),
   React.createElement("button",{onClick:buyBonus,className:"px-6 py-3 bg-purple-500 text-white rounded-xl"},"BUY BONUS 100x")
  ),

  React.createElement("div",{className:"mt-4 text-white"},
   "Balance: "+balance,
   React.createElement("br"),
   "Free Spins: "+freeSpins
  )
 )
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App))

</script>
</body>
</html>`)
})

// ======================
// START SERVER
// ======================

const PORT=process.env.PORT||3000
app.listen(PORT,()=>console.log("Running on",PORT))
