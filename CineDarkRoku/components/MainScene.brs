sub init()
    m.categoryList = m.top.FindNode("categoryList")
    m.categoryGrid = m.top.FindNode("categoryGrid")
    m.selectedTitle = m.top.FindNode("selectedTitle")
    m.status = m.top.FindNode("status")
    m.empty = m.top.FindNode("empty")
    m.categoryData = {}
    m.api = CreateObject("roSGNode", "ApiTask")
    m.api.ObserveField("result", "onCatalogResult")
    m.categoryList.ObserveField("itemSelected", "onCategorySelected")
    m.categoryGrid.ObserveField("itemSelected", "onSelected")
    m.categoryGrid.ObserveField("itemFocused", "onItemFocused")
    loadCatalog()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back" and m.video <> invalid then
        m.top.RemoveChild(m.video)
        m.video = invalid
        m.categoryList.SetFocus(true)
        return true
    end if
    if key = "back" and m.categoryGrid.HasFocus() then
        m.categoryList.SetFocus(true)
        return true
    end if
    return false
end function

sub loadCatalog()
    m.api.path = "/channels"
    m.api.control = "run"
end sub

sub onCatalogResult(event as Object)
    raw = event.GetData()
    data = invalid
    if raw <> invalid and raw <> "" then data = ParseJson(raw)
    categories = {}
    if data <> invalid then
        for each item in data
            if item.name <> invalid and item.url <> invalid and isMp4(item.url) then
                category = "Outros"
                if item.category <> invalid and item.category <> "" then category = item.category
                if categories[category] = invalid then categories[category] = []
                categories[category].Push({ title: item.name, hdPosterUrl: item.poster, url: item.url })
            end if
        end for
    end if
    if categories.Count() = 0 then
        m.status.Text = "Catalogo indisponivel"
        m.empty.Visible = true
        return
    end if
    m.categoryData = categories
    categoryContent = CreateObject("roSGNode", "ContentNode")
    for each categoryName in categories
        node = categoryContent.CreateChild("ContentNode")
        node.title = categoryName
    end for
    m.categoryList.Content = categoryContent
    m.status.Text = "Escolha uma categoria"
    m.categoryList.SetFocus(true)
end sub

sub onCategorySelected(event as Object)
    index = event.GetData()
    categoryNode = m.categoryList.Content.GetChild(index)
    if categoryNode = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    for each item in m.categoryData[categoryNode.title]
        node = content.CreateChild("ContentNode")
        node.title = item.title
        node.hdPosterUrl = item.hdPosterUrl
        node.url = item.url
    end for
    m.categoryGrid.Content = content
    m.status.Text = categoryNode.title
    m.categoryGrid.SetFocus(true)
end sub

sub onItemFocused(event as Object)
    index = event.GetData()
    if m.categoryGrid.Content <> invalid then
        item = m.categoryGrid.Content.GetChild(index)
        if item <> invalid then m.selectedTitle.Text = item.title
    end if
end sub

sub onSelected(event as Object)
    index = event.GetData()
    item = m.categoryGrid.Content.GetChild(index)
    if item = invalid or item.url = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    content.url = item.url
    content.title = item.title
    content.streamFormat = streamFormat(item.url)
    m.video = CreateObject("roSGNode", "Video")
    m.video.content = content
    ' Zero uses the actual display size in both HD and FHD UI modes.
    m.video.width = 0
    m.video.height = 0
    m.video.translation = [0, 0]
    m.video.visible = true
    m.top.AppendChild(m.video)
    m.video.SetFocus(true)
    m.video.control = "play"
end sub

function streamFormat(url as String) as String
    if LCase(Right(url, 5)) = ".m3u8" then return "hls"
    return "mp4"
end function

function isMp4(url as String) as Boolean
    value = LCase(url)
    return Instr(1, value, ".mp4") > 0
end function
