package com.example.tvbox

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebViewClient
import android.widget.Toast
import android.transition.Slide
import android.transition.TransitionManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.tvbox.databinding.ActivityMainBinding
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import kotlin.math.max
import kotlin.math.min

private data class KickPlaybackResponse(
    val data: String?
)

private data class WatchFootyMatch(
    val matchId: String?,
    val id: String?,
    val title: String?,
    val league: String?,
    val teams: WatchFootyTeams?,
    val scores: WatchFootyScores?,
    val streams: List<WatchFootyStream>?
)

private data class WatchFootyTeams(
    val home: WatchFootyTeam?,
    val away: WatchFootyTeam?
)

private data class WatchFootyTeam(
    val name: String?
)

private data class WatchFootyScores(
    val home: String?,
    val away: String?
)

private data class WatchFootyStream(
    val id: String?,
    val url: String?,
    val quality: String?,
    val language: String?,
    val nsfw: Boolean?
)

private data class SeriesCatalogEntry(
    val id: String?, val title: String?, val name: String?,
    val endpoint: String?, val url: String?, val poster: String?
)

private data class SeriesDetails(val title: String?, val seasons: List<SeriesSeason>?)
private data class SeriesSeason(val number: Int?, val season: Int?, val episodes: List<SeriesEpisode>?)
private data class SeriesEpisode(
    val number: Int?, val episode: Int?, val title: String?, val name: String?,
    val url: String?, val type: String?
)

private data class GithubRelease(val tag_name: String?, val assets: List<GithubReleaseAsset>?)
private data class GithubReleaseAsset(val name: String?, val browser_download_url: String?)

class MainActivity : AppCompatActivity() {

    private companion object {
        const val TVBOX_API_BASE = "http://164.152.62.129/tvbox/api"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var exoPlayer: ExoPlayer
    private lateinit var channelAdapter: ChannelAdapter
    private var allChannels: List<Channel> = emptyList()
    private var currentChannel: Channel? = null
    private val matchStreamGroups = mutableMapOf<String, List<Channel>>()
    private val footballGroups = mutableMapOf<String, List<Channel>>()
    private val movieGroups = mutableMapOf<String, List<Channel>>()
    private var activeMatchGroupId: String? = null
    private var activeMatchStreamIndex = 0
    private var seriesCatalogEntries: List<SeriesCatalogEntry> = emptyList()
    private var activeSeriesName: String? = null
    private var activeSeriesEpisodes: List<Channel> = emptyList()
    private var activeSeriesEpisodeIndex = -1
    private var seriesEpisodeMenuOpen = false
    private var footballGroupMenuOpen = false
    private var movieCategoryMenuOpen = false
    private var streamReloadAttempts = 0
    private var bufferingStartedAt = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val playbackWatchdog = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized &&
                currentChannel?.type?.lowercase() in setOf("kick", "hls") &&
                exoPlayer.playWhenReady &&
                exoPlayer.playbackState == Player.STATE_BUFFERING
            ) {
                val now = SystemClock.elapsedRealtime()
                if (bufferingStartedAt == 0L) {
                    bufferingStartedAt = now
                } else if (now - bufferingStartedAt >= 15_000) {
                    refreshCurrentStream("o player permaneceu carregando por 15 segundos")
                    bufferingStartedAt = now
                }
            }
            mainHandler.postDelayed(this, 5_000)
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupPlayer()
        setupIFrameWebView()
        setupRecyclerView()
        setupHomeMenu()
        loadChannels()
    }

    private fun setupPlayer() {
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(httpDataSourceFactory))
            .build()
        exoPlayer.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true
        )
        exoPlayer.volume = 1f
        binding.playerView.player = exoPlayer
        mainHandler.post(playbackWatchdog)
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                refreshCurrentStream("erro do player: ${error.errorCodeName}", error)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> bufferingStartedAt = SystemClock.elapsedRealtime()
                    Player.STATE_READY -> {
                        streamReloadAttempts = 0
                        bufferingStartedAt = 0L
                    }
                    else -> bufferingStartedAt = 0L
                }
            }
        })
    }

    private fun setupRecyclerView() {
        binding.recyclerView.layoutManager = LinearLayoutManager(this)
        channelAdapter = ChannelAdapter(emptyList()) { channel ->
            playChannel(channel)
        }
        binding.recyclerView.adapter = channelAdapter
    }

    private fun setupHomeMenu() {
        binding.homeVersion.text = "Micael Farias  •  Versão ${BuildConfig.VERSION_NAME}"
        binding.homeFootball.setOnClickListener { refreshAndOpenCategory("futebol") }
        binding.homeKick.setOnClickListener { refreshAndOpenCategory("kick") }
        binding.homeMovies.setOnClickListener { refreshAndOpenCategory("filmes") }
        binding.homeSeries.setOnClickListener { refreshAndOpenCategory("series") }
        binding.homeUpdate.setOnClickListener { checkForUpdate() }
    }

    private fun checkForUpdate() {
        binding.loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch(Dispatchers.IO) {
            val release = try {
                val request = Request.Builder()
                    .url("https://api.github.com/repos/micaelfariasdev/TvApp/releases/latest")
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "TVBox")
                    .build()
                OkHttpClient().newCall(request).execute().use { response ->
                    val body = response.body?.string()
                    if (response.isSuccessful && !body.isNullOrBlank()) Gson().fromJson(body, GithubRelease::class.java) else null
                }
            } catch (error: Exception) { null }

            withContext(Dispatchers.Main) {
                binding.loadingOverlay.visibility = View.GONE
                val remoteVersion = release?.tag_name
                if (!isVersionNewer(remoteVersion, BuildConfig.VERSION_NAME)) {
                    Toast.makeText(
                        this@MainActivity,
                        "Você já está na última versão (${BuildConfig.VERSION_NAME})",
                        Toast.LENGTH_LONG
                    ).show()
                    return@withContext
                }
                val apkUrl = release?.assets.orEmpty().firstOrNull {
                    it.name?.endsWith(".apk", ignoreCase = true) == true
                }?.browser_download_url
                if (apkUrl.isNullOrBlank()) {
                    Toast.makeText(this@MainActivity, "Nenhum APK encontrado na última release", Toast.LENGTH_LONG).show()
                } else {
                    Toast.makeText(this@MainActivity, "Baixando ${release?.tag_name ?: "atualização"}...", Toast.LENGTH_SHORT).show()
                    downloadAndInstallUpdate(apkUrl)
                }
            }
        }
    }

    /** Compara tags como v1.0.6, 1.0.10 e 1.1 sem depender de texto. */
    private fun isVersionNewer(remote: String?, installed: String): Boolean {
        if (remote.isNullOrBlank()) return false
        fun parts(value: String): List<Int> = value
            .trim()
            .removePrefix("v")
            .removePrefix("V")
            .split(Regex("[^0-9]+"))
            .filter { it.isNotBlank() }
            .map { it.toIntOrNull() ?: 0 }

        val remoteParts = parts(remote)
        val installedParts = parts(installed)
        val size = maxOf(remoteParts.size, installedParts.size)
        for (index in 0 until size) {
            val remotePart = remoteParts.getOrElse(index) { 0 }
            val installedPart = installedParts.getOrElse(index) { 0 }
            if (remotePart != installedPart) return remotePart > installedPart
        }
        return false
    }

    private fun downloadAndInstallUpdate(apkUrl: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            val apkFile = File(cacheDir, "tvbox-update.apk")
            val downloaded = try {
                val request = Request.Builder().url(apkUrl).build()
                OkHttpClient().newCall(request).execute().use { response ->
                    if (!response.isSuccessful) false else response.body?.byteStream()?.use { input ->
                        apkFile.outputStream().use { output -> input.copyTo(output) }
                        apkFile.length() > 0
                    } ?: false
                }
            } catch (error: Exception) { false }

            withContext(Dispatchers.Main) {
                if (!downloaded) {
                    Toast.makeText(this@MainActivity, "Não foi possível baixar a atualização", Toast.LENGTH_LONG).show()
                    return@withContext
                }
                val apkUri = FileProvider.getUriForFile(this@MainActivity, "$packageName.provider", apkFile)
                startActivity(Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                })
            }
        }
    }

    private fun refreshAndOpenCategory(category: String) {
        loadChannels { openCategory(category) }
    }

    private fun openCategory(category: String) {
        if (category == "series") {
            openSeriesCatalog()
            return
        }
        if (category == "futebol") {
            openFootballCatalog()
            return
        }
        if (category == "filmes") {
            openMovieCatalog()
            return
        }
        val channels = allChannels.filter { channelCategory(it) == category }
        if (channels.isEmpty()) {
            Log.w("TESTE_TV", "Nenhum canal encontrado para a categoria: $category")
            return
        }

        binding.homeMenu.visibility = View.GONE
        binding.channelPanelTitle.text = category.uppercase()
        showChannels(channels)
        showChannelMenu()
    }

    /** Primeiro nível do Futebol: campeonatos/dias; segundo: jogos/canais. */
    private fun openFootballCatalog() {
        val football = allChannels.filter { channelCategory(it) == "futebol" }
        if (football.isEmpty()) {
            Toast.makeText(this, "Nenhum jogo ou canal de futebol encontrado", Toast.LENGTH_SHORT).show()
            return
        }

        footballGroups.clear()
        football.groupBy { footballGroupLabel(it) }
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .forEach { (label, channels) ->
                footballGroups[label] = channels.sortedBy { it.name.lowercase() }
            }

        footballGroupMenuOpen = false
        binding.homeMenu.visibility = View.GONE
        binding.channelPanelTitle.text = "FUTEBOL"
        val groups = footballGroups.map { (label, channels) ->
            Channel(
                name = "$label  (${channels.size})",
                url = label,
                type = "football-group",
                category = "futebol"
            )
        }
        showChannels(groups)
        showChannelMenu()
    }

    private fun footballGroupLabel(channel: Channel): String {
        // O servidor é a fonte da organização: qualquer `category` recebida
        // (Premiere, ESPN, Internacional etc.) vira um grupo no menu Futebol.
        channel.category?.trim()?.takeIf { it.isNotBlank() }?.let { category ->
            return when (category.lowercase()) {
                "football", "futebol", "esporte", "esportes" -> "FUTEBOL"
                else -> category.uppercase()
            }
        }
        channel.group?.trim()?.takeIf { it.isNotBlank() }?.let { return it }
        if (channel.type.equals("match-group", ignoreCase = true)) return "AO VIVO"
        // Quando o servidor não informa campeonato, organizamos por data da agenda.
        val date = channel.startTime?.substringBefore(" ")?.trim()
        return if (!date.isNullOrBlank()) "AGENDA — $date" else "CANAIS DE FUTEBOL"
    }

    private fun openFootballGroup(groupId: String) {
        val channels = footballGroups[groupId].orEmpty()
        if (channels.isEmpty()) return
        footballGroupMenuOpen = true
        binding.channelPanelTitle.text = groupId.uppercase()
        showChannels(channels)
        showChannelMenu()
    }

    /** Primeiro nÃ­vel dos filmes: categorias recebidas do catÃ¡logo. */
    private fun openMovieCatalog() {
        val movies = allChannels.filter { channelCategory(it) == "filmes" }
        if (movies.isEmpty()) {
            Toast.makeText(this, "Nenhum filme encontrado", Toast.LENGTH_SHORT).show()
            return
        }

        movieGroups.clear()
        movies.groupBy { movieCategoryLabel(it) }
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .forEach { (label, channels) ->
                movieGroups[label] = channels.sortedBy { it.name.lowercase() }
            }

        movieCategoryMenuOpen = false
        binding.homeMenu.visibility = View.GONE
        binding.channelPanelTitle.text = "FILMES"
        val groups = movieGroups.map { (label, channels) ->
            Channel(
                name = "$label  (${channels.size})",
                url = label,
                type = "movie-group",
                category = "filmes"
            )
        }
        showChannels(groups)
        showChannelMenu()
    }

    private fun movieCategoryLabel(channel: Channel): String {
        val category = channel.category?.trim()
        if (!category.isNullOrBlank()) {
            return when (category.lowercase()) {
                "filme", "filmes", "movie", "movies" -> "FILMES"
                else -> category.uppercase()
            }
        }
        return "OUTROS FILMES"
    }

    private fun openMovieCategory(categoryId: String) {
        val movies = movieGroups[categoryId].orEmpty()
        if (movies.isEmpty()) return
        movieCategoryMenuOpen = true
        binding.channelPanelTitle.text = categoryId.uppercase()
        showChannels(movies)
        showChannelMenu()
    }

    private fun channelCategory(channel: Channel): String {
        return when (channel.category?.trim()?.lowercase()) {
            "futebol", "football", "esporte", "esportes" -> "futebol"
            "kick" -> "kick"
            "filme", "filmes", "movie", "movies" -> "filmes"
            "serie", "series", "tv", "tvshow", "tv-show" -> "series"
            else -> when (channel.type.lowercase()) {
                "kick" -> "kick"
                "mp4" -> "filmes"
                else -> "futebol"
            }
        }
    }

    private fun showHomeMenu() {
        binding.channelPanel.visibility = View.GONE
        binding.homeMenu.visibility = View.VISIBLE
        seriesEpisodeMenuOpen = false
        binding.homeFootball.requestFocus()
    }

    private fun openSeriesCatalog() {
        if (seriesCatalogEntries.isEmpty()) {
            Toast.makeText(this, "Nenhuma série encontrada", Toast.LENGTH_SHORT).show()
            return
        }

        activeSeriesName = null
        activeSeriesEpisodes = emptyList()
        activeSeriesEpisodeIndex = -1
        seriesEpisodeMenuOpen = false
        binding.homeMenu.visibility = View.GONE
        binding.channelPanelTitle.text = "SÉRIES"
        val series = seriesCatalogEntries.mapNotNull { entry ->
            val endpoint = entry.endpoint ?: entry.url ?: return@mapNotNull null
            val title = entry.title ?: entry.name ?: entry.id ?: return@mapNotNull null
            Channel(name = title, url = endpoint, type = "series-group", category = "series", series = title)
        }.sortedBy { it.name.lowercase() }
        showChannels(series)
        showChannelMenu()
    }

    private fun openSeriesEpisodes(endpoint: String, fallbackTitle: String) {
        binding.loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch(Dispatchers.IO) {
            val url = if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) endpoint
            else "http://164.152.62.129/${endpoint.trimStart('/')}"
            val details = try {
                val request = Request.Builder().url(url).header("Accept", "application/json").build()
                OkHttpClient().newCall(request).execute().use { response ->
                    val body = response.body?.string()
                    if (!response.isSuccessful || body.isNullOrBlank()) null else Gson().fromJson(body, SeriesDetails::class.java)
                }
            } catch (e: Exception) { null }
            val seriesName = details?.title ?: fallbackTitle
            val episodes = details?.seasons.orEmpty().flatMap { season ->
                season.episodes.orEmpty().mapIndexed { index, episode ->
                    Channel(
                        name = episode.title ?: episode.name ?: "Episode ${episode.number ?: episode.episode ?: index + 1}",
                        url = episode.url.orEmpty(), type = episode.type ?: "mp4", category = "series",
                        series = seriesName, season = season.number ?: season.season,
                        episode = episode.number ?: episode.episode ?: index + 1
                    )
                }
            }.filter { it.url.isNotBlank() }
                .sortedWith(compareBy<Channel> { it.season ?: 0 }.thenBy { it.episode ?: Int.MAX_VALUE })
            withContext(Dispatchers.Main) {
                binding.loadingOverlay.visibility = View.GONE
                if (episodes.isEmpty()) {
                    Toast.makeText(this@MainActivity, "No episodes found", Toast.LENGTH_SHORT).show()
                    return@withContext
                }
                activeSeriesName = seriesName
                activeSeriesEpisodes = episodes
                activeSeriesEpisodeIndex = lastWatchedSeriesEpisodeIndex(seriesName, episodes)
                seriesEpisodeMenuOpen = true
                binding.channelPanelTitle.text = seriesName.uppercase()
                showChannels(
                    episodes.mapIndexed { index, episode -> episode.copy(name = episodeMenuLabel(episode, index)) },
                    activeSeriesEpisodeIndex
                )
                // Escolher uma série apenas abre a lista: o episódio só toca
                // depois de um novo OK sobre ele.
                showChannelMenu()
            }
        }
    }

    private fun episodeMenuLabel(channel: Channel, index: Int): String {
        val marker = when {
            channel.season != null && channel.episode != null -> "T${channel.season} E${channel.episode}"
            channel.episode != null -> "EP ${channel.episode}"
            else -> "EP ${index + 1}"
        }
        val title = channel.name.trim()
        return if (title.isBlank()) marker else "$marker  •  $title"
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupIFrameWebView() {
        binding.iframeWebView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadsImagesAutomatically = true
            settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            setBackgroundColor(Color.BLACK)
        }
    }

    private fun loadChannels(onLoaded: (() -> Unit)? = null) {
        binding.loadingOverlay.visibility = View.VISIBLE
        val rawChannelsUrl = "$TVBOX_API_BASE/channels"
        val channelsUrl = "$rawChannelsUrl?t=${System.currentTimeMillis()}"

        lifecycleScope.launch(Dispatchers.IO) {
            val client = OkHttpClient()
            val rawChannels = fetchRawChannels(client, channelsUrl)
            val serieAChannels = fetchBrazilianSerieAChannels(client)
            val series = fetchSeriesCatalog(client, "$TVBOX_API_BASE/series?t=${System.currentTimeMillis()}")
            val channels = rawChannels + serieAChannels

            withContext(Dispatchers.Main) {
                allChannels = channels
                seriesCatalogEntries = series
                binding.loadingOverlay.visibility = View.GONE
                if (onLoaded == null) showHomeMenu() else onLoaded()
            }
        }
    }

    private fun fetchRawChannels(client: OkHttpClient, url: String): List<Channel> = try {
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful || body.isNullOrBlank()) {
                emptyList()
            } else {
                Gson().fromJson<List<Channel>>(body, object : TypeToken<List<Channel>>() {}.type)
                    .orEmpty()
            }
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun fetchSeriesCatalog(client: OkHttpClient, url: String): List<SeriesCatalogEntry> = try {
        val request = Request.Builder().url(url).header("Accept", "application/json").build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful || body.isNullOrBlank()) emptyList()
            else Gson().fromJson<List<SeriesCatalogEntry>>(body, object : TypeToken<List<SeriesCatalogEntry>>() {}.type).orEmpty()
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun fetchBrazilianSerieAChannels(client: OkHttpClient): List<Channel> = try {
        val request = Request.Builder()
            .url("https://api.watchfooty.st/api/v1/matches/live")
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful || body.isNullOrBlank()) {
                emptyList()
            } else {
                val matches = Gson().fromJson<List<WatchFootyMatch>>(
                    body,
                    object : TypeToken<List<WatchFootyMatch>>() {}.type
                ).orEmpty()
                matchStreamGroups.clear()
                matches
                    .filter { it.league.equals("Brazilian Serie A", ignoreCase = true) }
                    .mapNotNull { match ->
                        val streams = match.streams.orEmpty()
                            .filter { !it.url.isNullOrBlank() && it.nsfw != true }
                            .map { stream ->
                                val detail = listOfNotNull(stream.quality, stream.language)
                                    .joinToString(" • ")
                                    .ifBlank { "Iframe" }
                                Channel(
                                    name = detail,
                                    url = stream.url!!,
                                    type = "iframe",
                                    // Todos os jogos recebidos desta API ficam no
                                    // mesmo grupo da tela Futebol.
                                    category = "Brasileirão Série A"
                                )
                            }
                        if (streams.isEmpty()) return@mapNotNull null

                        val groupId = match.matchId ?: match.id ?: match.title ?: return@mapNotNull null
                        matchStreamGroups[groupId] = streams
                        val matchName = match.title ?: listOfNotNull(
                            match.teams?.home?.name,
                            match.teams?.away?.name
                        ).joinToString(" vs ").ifBlank { "Brazilian Serie A" }
                        val score = match.scores?.let { scores ->
                            if (!scores.home.isNullOrBlank() && !scores.away.isNullOrBlank()) {
                                "  ${scores.home} x ${scores.away}"
                            } else ""
                        }.orEmpty()
                        Channel(
                            name = "⚽ $matchName$score  (${streams.size} streams)",
                            url = groupId,
                            type = "match-group",
                            category = "futebol"
                        )
                    }
            }
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun showChannels(channels: List<Channel>, selectedIndex: Int = 0) {
        channelAdapter = ChannelAdapter(channels) { channel ->
            playChannel(channel)
            // O catálogo de uma série deve permanecer visível enquanto os
            // episódios são carregados; os demais itens iniciam a reprodução.
            if (!channel.type.equals("series-group", ignoreCase = true) &&
                !channel.type.equals("football-group", ignoreCase = true) &&
                !channel.type.equals("movie-group", ignoreCase = true)) {
                hideChannelMenu()
            }
        }
        binding.recyclerView.adapter = channelAdapter
        val targetIndex = selectedIndex.coerceIn(0, (channels.size - 1).coerceAtLeast(0))
        binding.recyclerView.scrollToPosition(targetIndex)
        binding.recyclerView.post {
            (binding.recyclerView.findViewHolderForAdapterPosition(targetIndex)?.itemView
                ?: binding.recyclerView).requestFocus()
        }
    }

    private fun showChannelMenu() {
        if (binding.channelPanel.visibility == View.VISIBLE) return
        animateChannelPanel()
        binding.channelPanel.visibility = View.VISIBLE
        binding.recyclerView.requestFocus()
    }

    private fun hideChannelMenu() {
        if (binding.channelPanel.visibility != View.VISIBLE) return
        animateChannelPanel()
        binding.channelPanel.visibility = View.GONE
        binding.mainContainer.requestFocus()
    }

    private fun animateChannelPanel() {
        TransitionManager.beginDelayedTransition(
            binding.mainContainer,
            Slide(Gravity.START).apply { duration = 180 }
        )
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (binding.homeMenu.visibility == View.VISIBLE) {
                return super.dispatchKeyEvent(event)
            }
            if (
                binding.iframeWebView.visibility == View.VISIBLE &&
                binding.channelPanel.visibility != View.VISIBLE &&
                event.keyCode in setOf(
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_NUMPAD_ENTER
                )
            ) {
                tapIFrameCenter()
                return true
            }
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && seekMovie(-10_000)) {
                        return true
                    }
                    if (binding.channelPanel.visibility != View.VISIBLE && changeMatchStream(-1)) {
                        return true
                    }
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && seekMovie(10_000)) {
                        return true
                    }
                    if (binding.channelPanel.visibility != View.VISIBLE && changeMatchStream(1)) {
                        return true
                    }
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.KEYCODE_DPAD_UP -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && changeSeriesEpisode(-1)) return true
                }
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && changeSeriesEpisode(1)) return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            binding.homeMenu.visibility == View.VISIBLE -> super.onBackPressed()
            binding.channelPanel.visibility == View.VISIBLE && seriesEpisodeMenuOpen -> openSeriesCatalog()
            binding.channelPanel.visibility == View.VISIBLE && movieCategoryMenuOpen -> openMovieCatalog()
            binding.channelPanel.visibility == View.VISIBLE && footballGroupMenuOpen -> openFootballCatalog()
            binding.channelPanel.visibility == View.VISIBLE -> showHomeMenu()
            else -> showChannelMenu()
        }
    }

    private fun tapIFrameCenter() {
        val webView = binding.iframeWebView
        if (webView.width == 0 || webView.height == 0) return

        val now = SystemClock.uptimeMillis()
        val x = webView.width / 2f
        val y = webView.height / 2f
        val downEvent = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0)
        val upEvent = MotionEvent.obtain(now, now + 40, MotionEvent.ACTION_UP, x, y, 0)
        webView.dispatchTouchEvent(downEvent)
        webView.dispatchTouchEvent(upEvent)
        downEvent.recycle()
        upEvent.recycle()
    }

    private fun playChannel(channel: Channel) {
        saveMovieProgress()
        if (channel.type.equals("series-group", ignoreCase = true)) {
            openSeriesEpisodes(channel.url, channel.series ?: channel.name)
            return
        }
        if (channel.type.equals("match-group", ignoreCase = true)) {
            activeMatchGroupId = channel.url
            activeMatchStreamIndex = 0
            playActiveMatchStream()
            return
        }
        if (channel.type.equals("football-group", ignoreCase = true)) {
            openFootballGroup(channel.url)
            return
        }
        if (channel.type.equals("movie-group", ignoreCase = true)) {
            openMovieCategory(channel.url)
            return
        }

        activeMatchGroupId = null
        currentChannel = channel
        if (activeSeriesEpisodes.isNotEmpty()) {
            activeSeriesEpisodeIndex = activeSeriesEpisodes.indexOfFirst { it.url == channel.url }
            if (activeSeriesEpisodeIndex >= 0) saveLastWatchedSeriesEpisode(channel.url)
        }
        streamReloadAttempts = 0
        when (channel.type.lowercase()) {
            // HLS deve usar o ExoPlayer primeiro. Alguns provedores aceitam o
            // player nativo, mas outros precisam do WebView como alternativa.
            "hls" -> playStream(channel.url)
            "mp4" -> playStream(channel.url, movieResumePosition(channel))
            "kick" -> resolveAndPlayKick(channel.url)
            "iframe", "web", "browser" -> playBrowserPage(channel.url)
            else -> Log.e("TESTE_TV", "Tipo de canal nao suportado: ${channel.type}")
        }
    }

    private fun changeMatchStream(direction: Int): Boolean {
        val streams = activeMatchGroupId?.let(matchStreamGroups::get).orEmpty()
        if (streams.size < 2) return false

        activeMatchStreamIndex = (activeMatchStreamIndex + direction + streams.size) % streams.size
        playActiveMatchStream()
        return true
    }

    private fun changeSeriesEpisode(direction: Int): Boolean {
        if (activeSeriesEpisodes.isEmpty() || activeSeriesEpisodeIndex !in activeSeriesEpisodes.indices) return false
        val nextIndex = activeSeriesEpisodeIndex + direction
        if (nextIndex !in activeSeriesEpisodes.indices) {
            Toast.makeText(this, if (direction > 0) "Último episódio" else "Primeiro episódio", Toast.LENGTH_SHORT).show()
            return true
        }
        playChannel(activeSeriesEpisodes[nextIndex])
        Toast.makeText(this, episodeMenuLabel(activeSeriesEpisodes[nextIndex], nextIndex), Toast.LENGTH_SHORT).show()
        return true
    }

    private fun playActiveMatchStream() {
        val streams = activeMatchGroupId?.let(matchStreamGroups::get).orEmpty()
        val stream = streams.getOrNull(activeMatchStreamIndex) ?: return
        currentChannel = stream
        streamReloadAttempts = 0
        playBrowserPage(stream.url)
        Toast.makeText(
            this,
            "${stream.name}  •  ${activeMatchStreamIndex + 1}/${streams.size}",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun resolveAndPlayKick(playbackEndpoint: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url(playbackEndpoint)
                    .header("Accept", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .build()
                OkHttpClient().newCall(request).execute().use { response ->
                    val body = response.body?.string()
                    if (!response.isSuccessful || body.isNullOrEmpty()) return@use

                    val playbackUrl = Gson().fromJson(body, KickPlaybackResponse::class.java).data
                    if (playbackUrl.isNullOrBlank()) return@use

                    // A Kick entrega uma URL HLS temporária própria; reproduza-a no
                    // ExoPlayer para não depender da simulação de navegador.
                    withContext(Dispatchers.Main) { playStream(playbackUrl) }
                }
            } catch (e: Exception) {
                // Tratado
            }
        }
    }

    private fun refreshCurrentStream(reason: String, error: Throwable? = null) {
        val channel = currentChannel ?: return
        if (streamReloadAttempts >= 2) return
        streamReloadAttempts++
        when (channel.type.lowercase()) {
            "kick" -> resolveAndPlayKick(channel.url)
            // O fallback do HLS é o simulador de navegador. Não repetimos a
            // tentativa nativa para evitar ficar preso em carregamento.
            "hls" -> playHlsAsBrowser(channel.url)
            "mp4" -> playStream(channel.url, movieResumePosition(channel))
            else -> {}
        }
    }

    // Método para simular navegador reproduzindo HLS (.m3u8) via HTML5 nativo com player Video.js (ou tag video padrão com suporte)
    private fun playHlsAsBrowser(url: String) {
        if (url.isBlank()) return
        exoPlayer.pause()
        binding.playerView.visibility = View.GONE
        binding.iframeWebView.visibility = View.VISIBLE

        val html = """
            <!doctype html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>
                    html, body { margin:0; width:100%; height:100%; overflow:hidden; background:#000; }
                    video { width:100%; height:100%; object-fit:contain; }
                </style>
                <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
            </head>
            <body>
                <video id="video" controls autoplay playsinline></video>
                <script>
                    var video = document.getElementById('video');
                    var videoSrc = '$url';
                    if (Hls.isSupported()) {
                        var hls = new Hls();
                        hls.loadSource(videoSrc);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED,function() {
                            video.play().catch(function(e){ console.log(e); });
                        });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = videoSrc;
                        video.addEventListener('loadedmetadata',function() {
                            video.play().catch(function(e){ console.log(e); });
                        });
                    }
                </script>
            </body>
            </html>
        """.trimIndent()

        binding.iframeWebView.loadDataWithBaseURL("https://admin2.formaturamaxi.com.br/", html, "text/html", "UTF-8", null)
    }

    private fun playStream(url: String, resumePositionMs: Long = 0L) {
        if (url.isBlank()) return
        hideIFramePlayer()
        val mediaItem = MediaItem.fromUri(url)
        exoPlayer.setMediaItem(mediaItem)
        if (resumePositionMs > 0) exoPlayer.seekTo(resumePositionMs)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
    }

    private fun isMoviePlaying(): Boolean = (currentChannel?.type ?: "").equals("mp4", ignoreCase = true) &&
        binding.playerView.visibility == View.VISIBLE

    private fun seekMovie(deltaMs: Long): Boolean {
        if (!isMoviePlaying()) return false
        val duration = exoPlayer.duration.takeIf { it > 0 } ?: return false
        val target = min(max(exoPlayer.currentPosition + deltaMs, 0L), duration)
        exoPlayer.seekTo(target)
        Toast.makeText(this, "${if (deltaMs > 0) "Avançando" else "Voltando"} ${kotlin.math.abs(deltaMs) / 1000}s", Toast.LENGTH_SHORT).show()
        return true
    }

    private fun movieResumePosition(channel: Channel): Long {
        return getSharedPreferences("movie_progress", MODE_PRIVATE)
            .getLong("position_${channel.url.hashCode()}", 0L)
    }

    private fun seriesProgressKey(seriesName: String): String =
        "last_episode_${seriesName.trim().lowercase().hashCode()}"

    private fun saveLastWatchedSeriesEpisode(episodeUrl: String) {
        val seriesName = activeSeriesName ?: return
        getSharedPreferences("series_progress", MODE_PRIVATE)
            .edit()
            .putString(seriesProgressKey(seriesName), episodeUrl)
            .apply()
    }

    private fun lastWatchedSeriesEpisodeIndex(seriesName: String, episodes: List<Channel>): Int {
        val savedUrl = getSharedPreferences("series_progress", MODE_PRIVATE)
            .getString(seriesProgressKey(seriesName), null)
        return episodes.indexOfFirst { it.url == savedUrl }.takeIf { it >= 0 } ?: 0
    }

    private fun saveMovieProgress() {
        val movie = currentChannel ?: return
        if (!movie.type.equals("mp4", ignoreCase = true)) return
        val position = exoPlayer.currentPosition
        val duration = exoPlayer.duration
        val preferences = getSharedPreferences("movie_progress", MODE_PRIVATE)
        val key = "position_${movie.url.hashCode()}"
        if (position < 5_000 || (duration > 0 && position >= duration - 10_000)) {
            preferences.edit().remove(key).apply()
        } else {
            preferences.edit().putLong(key, position).apply()
        }
    }

    private fun playIFrame(url: String) {
        if (url.isBlank()) return
        exoPlayer.pause()
        binding.playerView.visibility = View.GONE
        binding.iframeWebView.visibility = View.VISIBLE
        val html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000}</style></head>
            <body><iframe src="$url" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></body></html>
        """.trimIndent()
        binding.iframeWebView.loadDataWithBaseURL(url, html, "text/html", "UTF-8", null)
    }

    /**
     * Abre páginas de transmissão no WebView como um navegador real. Carregar
     * a página diretamente evita bloqueios de X-Frame-Options/CSP que ocorrem
     * quando ela é colocada dentro de um segundo iframe.
     */
    private fun playBrowserPage(url: String) {
        if (url.isBlank()) return
        exoPlayer.pause()
        binding.playerView.visibility = View.GONE
        binding.iframeWebView.visibility = View.VISIBLE
        binding.iframeWebView.loadUrl(url)
    }

    private fun hideIFramePlayer() {
        binding.iframeWebView.stopLoading()
        binding.iframeWebView.loadUrl("about:blank")
        binding.iframeWebView.visibility = View.GONE
        binding.playerView.visibility = View.VISIBLE
    }

    override fun onStop() {
        saveMovieProgress()
        super.onStop()
    }

    override fun onDestroy() {
        super.onDestroy()
        saveMovieProgress()
        mainHandler.removeCallbacks(playbackWatchdog)
        binding.iframeWebView.destroy()
        exoPlayer.release()
        binding.recyclerView.adapter = null
    }
}
