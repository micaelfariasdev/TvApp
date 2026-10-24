sub init()
    m.cover = m.top.FindNode("cover")
    m.fallback = m.top.FindNode("fallback")
    m.cover.ObserveField("loadStatus", "onCoverStatus")
end sub

sub onContent()
    content = m.top.itemContent
    if content = invalid then return
    m.top.FindNode("title").text = content.title
    m.fallback.visible = true
    m.cover.uri = content.hdPosterUrl
end sub

sub onCoverStatus()
    m.fallback.visible = (m.cover.loadStatus <> "ready")
end sub

sub onFocus()
    if m.top.focusPercent > 0.5 then
        m.top.FindNode("surface").color = "0x6340A8FF"
    else
        m.top.FindNode("surface").color = "0x1B2030FF"
    end if
end sub
