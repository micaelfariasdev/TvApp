package com.example.tvbox

import com.google.gson.annotations.SerializedName

data class Channel(
    val name: String,
    val url: String,
    val type: String = "hls",
    val category: String? = null,
    @SerializedName(value = "group", alternate = ["league", "competition"])
    val group: String? = null,
    @SerializedName("start_time")
    val startTime: String? = null,
    val series: String? = null,
    val season: Int? = null,
    val episode: Int? = null
)
