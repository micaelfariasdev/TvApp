sub init()
    m.top.functionName = "run"
end sub

sub run()
    xfer = CreateObject("roUrlTransfer")
    if xfer = invalid then
        m.top.result = ""
        return
    end if
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.SetRequest("GET")
    xfer.SetUrl("http://164.152.62.129/tvbox/api" + m.top.path)
    body = xfer.GetToString()
    if body = invalid or body = "" then
        m.top.result = ""
        return
    end if
    m.top.result = body
end sub

