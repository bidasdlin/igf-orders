import { NextResponse } from 'next/server'

const QB_BASE = `https://quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

async function getAccessToken() {
  const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: `grant_type=refresh_token&refresh_token=${process.env.QBO_REFRESH_TOKEN}`
  })
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

async function qbQuery(token: string, query: string) {
  const url = `${QB_BASE}/query?query=${encodeURIComponent(query)}&minorversion=65`
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`QB query error: ${await res.text()}`)
  return res.json()
}

async function qbCreate(token: string, entity: string, payload: object) {
  const url = `${QB_BASE}/${entity}?minorversion=65`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { ok: res.ok, status: res.status, data: await res.json() }
}

function parseDate(d: string) {
  // MM/DD/YY -> YYYY-MM-DD
  try {
    const [m, day, y] = d.split('/')
    return `20${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
  } catch { return '2026-03-17' }
}

export async function POST() {
  try {
    const token = await getAccessToken()

    // Get vendors
    const vResp = await qbQuery(token, 'SELECT * FROM Vendor MAXRESULTS 100')
    const qbVendors: Record<string, string> = {}
    for (const v of vResp?.QueryResponse?.Vendor ?? []) {
      qbVendors[v.DisplayName.toLowerCase().trim()] = v.Id
    }

    // Get expense account (COGS or first Expense)
    let accountId = '1'
    const aResp = await qbQuery(token, "SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 5")
    const accts = aResp?.QueryResponse?.Account ?? []
    if (accts.length > 0) accountId = accts[0].Id
    else {
      const aResp2 = await qbQuery(token, "SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 5")
      const accts2 = aResp2?.QueryResponse?.Account ?? []
      if (accts2.length > 0) accountId = accts2[0].Id
    }

    // All 53 NDC POs
    const ALL_POS = [
      {"po_number":"0000104670","vendor":"YUANQUANWOOD IND CO.","order_date":"03/12/26","total_amount":17751.55,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":14,"item_code":"AWB1820TEO","description":"48.5x96.5 48 pcs/unit 18mm C-2 White Birch TH EUC OVR"}]},
      {"po_number":"X0000851769","vendor":"Cambodian Golden Pearl Ind","order_date":"03/16/26","total_amount":24562.18,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1822KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"X0000851748","vendor":"Yuodchaiya Pruck Wood","order_date":"03/14/26","total_amount":22718.98,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1220TO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch TH Trop OVR"}]},
      {"po_number":"X0000851741","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":22504.70,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1220KEO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"X0000851777","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":34370.56,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW0531KRO","description":"48.5x96.5 175 pcs/unit 5.2mm C-3 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"0000202132","vendor":"United Forest Products PTE","order_date":"04/22/26","total_amount":20931.46,"freight_term":"DDP-PDX","branch":"VANC","items":[{"qty":14,"item_code":"AMX17X6TO","description":"48.5x96.5 50 pcs/Unit 11/16 MDX Platforms TH OVR"}]},
      {"po_number":"X0000851738","vendor":"YUANQUANWOOD IND CO.","order_date":"04/22/26","total_amount":21861.50,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1220TEO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch TH EUC OVR"}]},
      {"po_number":"0000605275","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24390.53,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"APW1221KR","description":"48x96 75 pcs/unit 12mm C-2 Prime White Birch UV1S CM RW"}]},
      {"po_number":"0000403271","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":22976.26,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1821KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"X0000851739","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820KEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"0000605274","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24347.90,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"APW1822KR","description":"48x96 50 pcs/unit 18mm C-2 Prime White Birch UV2S CM RW"}]},
      {"po_number":"X0000851776","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":34370.56,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW0531KRO","description":"48.5x96.5 175 pcs/unit 5.2mm C-3 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"0000202133","vendor":"United Forest Products PTE","order_date":"04/22/26","total_amount":20931.46,"freight_term":"DDP-PDX","branch":"VANC","items":[{"qty":14,"item_code":"AMX17X6TO","description":"48.5x96.5 50 pcs/Unit 11/16 MDX Platforms TH OVR"}]},
      {"po_number":"0000104678","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":23233.28,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1821KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 White Birch UV1S CM RW OVR"}]},
      {"po_number":"X0000851740","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820KEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"0000104671","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16254.81,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1890TE","description":"48x96 48 pcs/unit 18mm Furniture Grade TH EUC"}]},
      {"po_number":"0000104673","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16254.81,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1890TE","description":"48x96 48 pcs/unit 18mm Furniture Grade TH EUC"}]},
      {"po_number":"X0000851742","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":22504.70,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1220KEO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"X0000851768","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24562.18,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1822KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"0000202131","vendor":"United Forest Products PTE","order_date":"04/22/26","total_amount":27049.62,"freight_term":"DDP-PDX","branch":"VANC","items":[{"qty":11,"item_code":"AWB1920TEO","description":"48x120 51 pcs/unit 19mm C-2 White Birch TH EUC 4x10"}]},
      {"po_number":"X0000851774","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":26962.56,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1222KRO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"0000605263","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"APW1820KE","description":"48x96 50 pcs/unit 18mm C-2 Prime White Birch CM Euc"}]},
      {"po_number":"0000403273","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24562.18,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1822KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"0000403272","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24562.18,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1822KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"X0000851775","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":28345.86,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW0530KRO","description":"48.5x96.5 175 pcs/unit 5.2mm C-3 Prime White Birch CM RW OVR"}]},
      {"po_number":"0000104672","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16254.81,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1890TE","description":"48x96 48 pcs/unit 18mm Furniture Grade TH EUC"}]},
      {"po_number":"X0000851743","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":29039.36,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW0530KEO","description":"48.5x96.5 175 pcs/unit 5.2mm C-3 Prime White Birch CM EUC OVR"}]},
      {"po_number":"X0000851771","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24605.18,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1221KRO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"X0000851747","vendor":"Yuodchaiya Pruck Wood","order_date":"04/22/26","total_amount":22718.98,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1220TO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch TH Trop OVR"}]},
      {"po_number":"0000403263","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":22504.70,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1220KEO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"X0000851737","vendor":"YUANQUANWOOD IND CO.","order_date":"04/22/26","total_amount":20790.02,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820TEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch TH EUC OVR"}]},
      {"po_number":"0000605273","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24347.90,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"APW1822KR","description":"48x96 50 pcs/unit 18mm C-2 Prime White Birch UV2S CM RW"}]},
      {"po_number":"X0000851736","vendor":"YUANQUANWOOD IND CO.","order_date":"04/22/26","total_amount":20790.02,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820TEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch TH EUC OVR"}]},
      {"po_number":"0000403262","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1820KEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"X0000851746","vendor":"Yuodchaiya Pruck Wood","order_date":"04/22/26","total_amount":20164.12,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820TO","description":"48.5x96.5 48 pcs/unit 18mm C-2 Prime White Birch TH Trop OVR"}]},
      {"po_number":"0000202135","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":20495.16,"freight_term":"DDP-PDX","branch":"VANC","items":[{"qty":15,"item_code":"AWB1220KR","description":"48x96 75 pcs/unit 12mm C-2 White Birch CM RW"}]},
      {"po_number":"X0000851770","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24562.18,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1822KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"0000104669","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16956.67,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":14,"item_code":"AWB2520TE","description":"48x96 35 pcs/unit 25mm C-2 White Birch TH EUC"}]},
      {"po_number":"X0000851772","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24605.18,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1221KRO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"X0000851767","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":22976.26,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1821KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"0000104681","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":24433.69,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1922KRO","description":"48.5x96.5 45 pcs/unit 19mm C-2 White Birch UV2S CM RW OVR"}]},
      {"po_number":"X0000851744","vendor":"Yuodchaiya Pruck Wood","order_date":"04/22/26","total_amount":20164.12,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820TO","description":"48.5x96.5 48 pcs/unit 18mm C-2 Prime White Birch TH Trop OVR"}]},
      {"po_number":"0000403260","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1820KEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"0000403275","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":34370.56,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW0531KRO","description":"48.5x96.5 175 pcs/unit 5.2mm C-3 Prime Wt Birch UV1S CM RW OVR"}]},
      {"po_number":"0000605265","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16254.81,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"AWB1890TE","description":"48x96 48 pcs/unit 18mm Furniture Grade TH EUC"}]},
      {"po_number":"0000605264","vendor":"YUANQUANWOOD IND CO.","order_date":"04/15/26","total_amount":16254.81,"freight_term":"DDP-HOU","branch":"TEXAS","items":[{"qty":16,"item_code":"AWB1890TE","description":"48x96 48 pcs/unit 18mm Furniture Grade TH EUC"}]},
      {"po_number":"0000403261","vendor":"Quan Ming Shun NewMateria","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1820KEO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime White Birch CM EUC OVR"}]},
      {"po_number":"0000403274","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":26962.56,"freight_term":"DDP-NY","branch":"NE","items":[{"qty":16,"item_code":"APW1222KRO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"X0000851745","vendor":"Yuodchaiya Pruck Wood","order_date":"04/22/26","total_amount":20164.12,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1820TO","description":"48.5x96.5 48 pcs/unit 18mm C-2 Prime White Birch TH Trop OVR"}]},
      {"po_number":"0000104674","vendor":"United Forest Products PTE","order_date":"04/22/26","total_amount":27049.62,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":11,"item_code":"AWB1920TEO","description":"48x120 51 pcs/unit 19mm C-2 White Birch TH EUC 4x10"}]},
      {"po_number":"0000104680","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":21004.29,"freight_term":"DDP-LA","branch":"LA","items":[{"qty":16,"item_code":"AWB1820KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 White Birch CM RW OVR"}]},
      {"po_number":"X0000851773","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":26962.56,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1222KRO","description":"48.5x96.5 75 pcs/unit 12mm C-2 Prime Wt Birch UV2S CM RW OVR"}]},
      {"po_number":"X0000851766","vendor":"Cambodian Golden Pearl Ind","order_date":"04/22/26","total_amount":22976.26,"freight_term":"DDP-SAV","branch":"XA","items":[{"qty":16,"item_code":"APW1821KRO","description":"48.5x96.5 50 pcs/unit 18mm C-2 Prime Wt Birch UV1S CM RW OVR"}]},
    ]

    const results = { success: [] as string[], failed: [] as string[], vendorMissing: [] as string[] }
    let totalValue = 0

    for (const po of ALL_POS) {
      const vKey = po.vendor.toLowerCase().trim()
      let vendorId = qbVendors[vKey]

      // Fuzzy match
      if (!vendorId) {
        for (const [k, id] of Object.entries(qbVendors)) {
          if (k.includes(vKey.split(' ')[0]) || vKey.includes(k.split(' ')[0])) {
            vendorId = id; break
          }
        }
      }

      // Auto-create vendor if not found
      if (!vendorId) {
        const r = await qbCreate(token, 'vendor', { DisplayName: po.vendor })
        if (r.ok) {
          vendorId = r.data?.Vendor?.Id
          qbVendors[vKey] = vendorId
        }
      }

      if (!vendorId) {
        results.vendorMissing.push(po.po_number)
        continue
      }

      const item = po.items[0]
      const payload = {
        VendorRef: { value: vendorId },
        TxnDate: parseDate(po.order_date),
        DocNumber: po.po_number,
        Memo: `NDC Branch: ${po.branch} | ${po.freight_term} | ${item.item_code}`,
        POStatus: 'Open',
        Line: [{
          Amount: po.total_amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: `${item.qty} units ${item.item_code} — ${item.description}`,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: accountId },
            BillableStatus: 'NotBillable',
            TaxCodeRef: { value: 'NON' }
          },
          LineNum: 1
        }],
        TotalAmt: po.total_amount
      }

      const r = await qbCreate(token, 'purchaseorder', payload)
      if (r.ok) {
        results.success.push(po.po_number)
        totalValue += po.total_amount
      } else {
        results.failed.push(`${po.po_number}:${r.status}`)
      }
    }

    return NextResponse.json({
      success: true,
      created: results.success.length,
      failed: results.failed.length,
      vendorMissing: results.vendorMissing.length,
      totalValue: totalValue.toFixed(2),
      details: results
    })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
