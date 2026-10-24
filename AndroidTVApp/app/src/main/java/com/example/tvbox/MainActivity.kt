package com.example.tvbox

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
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
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ArrayAdapter
import android.widget.AdapterView
import androidx.appcompat.app.AlertDialog
import android.transition.Slide
import android.transition.TransitionManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaChunkExtractor
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.PlayerView
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.example.tvbox.databinding.ActivityMainBinding
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress
import okhttp3.Request
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import android.graphics.Rect
import androidx.media3.exoplayer.DefaultLoadControl
import coil.load

private data class KickLiveResponse(val channels: List<KickLiveChannel> = emptyList())

private data class BrasileirãoEventsResponse(val events: List<BrasileirãoEvent> = emptyList())
private data class BrasileirãoEvent(
    val id: Long?,
    val title: String?,
    val time_start: String?,
    val players: List<String>?,
    val league: BrasileirãoLeague?,
    val teams: BrasileirãoTeams?
)
private data class BrasileirãoLeague(val name: String?, val image: String?)
private data class BrasileirãoTeams(val home: BrasileirãoTeam?, val away: BrasileirãoTeam?)
private data class BrasileirãoTeam(val name: String?, val image: String?)

private data class BrazilianEventsResponse(val events: List<BrazilianEvent> = emptyList())
private data class BrazilianEvent(
    val id: Long?,
    val title: String?,
    val time_start: String?,
    val players: List<BrazilianPlayer> = emptyList(),
    val league: BrazilianLeague?,
    val teams: BrazilianTeams?
)
private data class BrazilianPlayer(val apiUrl: String?, val status: String?)
private data class BrazilianLeague(val name: String?, val image: String?)
private data class BrazilianTeams(val home: BrazilianTeam?, val away: BrazilianTeam?)
private data class BrazilianTeam(val name: String?, val image: String?)

private data class EmbedEventsResponse(val events: List<EmbedEvent> = emptyList())
private data class EmbedEvent(
    val title: String?, val time_start: String?,
    val league: EmbedLeague?, val teams: EmbedTeams?,
    val players: List<EmbedPlayer> = emptyList()
)
private data class EmbedPlayer(val apiUrl: String?, val status: String?)
private data class EmbedLeague(val name: String?, val image: String?)
private data class EmbedTeams(val home: EmbedTeam?, val away: EmbedTeam?)
private data class EmbedTeam(val name: String?, val image: String?)

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

private data class SeriesDetails(
    val title: String?,
    val poster: String?,
    val seasons: List<SeriesSeason>?
)
private data class SeriesSeason(val number: Int?, val season: Int?, val episodes: List<SeriesEpisode>?)
private data class SeriesEpisode(
    val number: Int?, val episode: Int?, val title: String?, val name: String?,
    val url: String?, val type: String?
)
private data class HomeConfig(val sections: List<HomeSection>?, val banners: List<HomeBanner>?)
private data class HomeBanner(
    val target: String?, val title: String?, val subtitle: String?, val image: String?, val enabled: Boolean?
)
private data class BannerSlide(val channel: Channel, val title: String, val subtitle: String, val image: String?)
private data class HomeSection(
    val id: String?, val type: String?, val title: String?, val category: String?,
    val enabled: Boolean?, val limit: Int?
)

private data class GithubRelease(val tag_name: String?, val assets: List<GithubReleaseAsset>?)
private data class GithubReleaseAsset(val name: String?, val browser_download_url: String?)

class MainActivity : AppCompatActivity() {

    private companion object {
        const val TVBOX_API_BASE = "http://164.152.62.129/tvbox/api"
}

    private lateinit var binding: ActivityMainBinding
    private lateinit var exoPlayer: ExoPlayer
    private lateinit var hlsMediaSourceFactory: HlsMediaSource.Factory
    private lateinit var playerTitleOverlay: TextView
    private lateinit var fullscreenButton: android.widget.Button
    private lateinit var kickLiveAdapter: KickLiveAdapter
    private var kickLiveLoading = false
    private val kickLiveClient = OkHttpClient()
    private val kickLiveRefresh = object : Runnable {
        override fun run() {
            if (binding.homeMenu.visibility == View.VISIBLE) {
                loadKickLiveChannels()
                loadTodayBrazilianMatches()
            }
            mainHandler.postDelayed(this, 60_000)
        }
    }
    private lateinit var channelAdapter: ChannelAdapter
    private lateinit var homeMovieAdapter: MediaCardAdapter
    private lateinit var homeSeriesAdapter: MediaCardAdapter
    private lateinit var homeRecentAdapter: MediaCardAdapter
    private lateinit var homeMatchesAdapter: TodayMatchAdapter
    private lateinit var seriesGridAdapter: MediaCardAdapter
    private lateinit var episodesGridAdapter: MediaCardAdapter
    private lateinit var catalogGridAdapter: MediaCardAdapter
    private var allChannels: List<Channel> = emptyList()
    private var channelsLoading = false
    private var initialCatalogLoaded = false
    private var sidebarExpanded: Boolean? = null
    private var startupAnimator: android.animation.AnimatorSet? = null
    private val sidebarFocusListener = android.view.ViewTreeObserver.OnGlobalFocusChangeListener { _, _ ->
        binding.sidebar.post { if (!isFinishing) updateSidebar(binding.sidebar.hasFocus()) }
    }
    private var currentChannel: Channel? = null
    private var recentItems: List<Channel> = emptyList()
    private val recentPrefsName = "watch_history"
    private val recentKey = "items"
    private val matchStreamGroups = mutableMapOf<String, List<Channel>>()
    private val footballGroups = mutableMapOf<String, List<Channel>>()
    private val movieGroups = mutableMapOf<String, List<Channel>>()
    private var activeMatchGroupId: String? = null
    private var activeMatchStreamIndex = 0
    private var seriesCatalogEntries: List<SeriesCatalogEntry> = emptyList()
    private var homeSections: List<HomeSection> = emptyList()
    private var homeBanners: List<HomeBanner> = emptyList()
    private var bannerSlides: List<BannerSlide> = emptyList()
    private var bannerIndex = 0
    private val bannerRotation = object : Runnable {
        override fun run() {
            if (binding.homeMenu.visibility == View.VISIBLE && !binding.homeHeroBanner.hasFocus() && bannerSlides.size > 1) {
                selectBanner(bannerIndex + 1)
            }
            mainHandler.postDelayed(this, 8_000)
        }
    }
    private var playerReturnScreen = "home"
    private var playerReturnGridState: android.os.Parcelable? = null
    private var playerReturnGridPosition = 0
    private var activeSeriesName: String? = null
    private var activeSeriesEpisodes: List<Channel> = emptyList()
    private var activeSeriesSeason: Int? = null
    private var activeSeriesEpisodeIndex = -1
    private var seriesEpisodeMenuOpen = false
    private var footballGroupMenuOpen = false
    private var movieCategoryMenuOpen = false
    private var playerReturnWasChannels = false
    private var playerReturnWasHome = true
    private var streamReloadAttempts = 0
    private var bufferingStartedAt = 0L
    private var hlsLastPositionMs = C.TIME_UNSET
    private var hlsLastProgressAt = 0L
    private var hlsLastRecoveryAt = 0L
    /** True only while the app is recovering a stalled HLS stream. */
    private var hlsRecovering = false
    private var hlsRecoveryAttempts = 0
    private var hlsStartedAt = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val playbackWatchdog = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized &&
                currentChannel?.type?.lowercase() == "kick" &&
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
    
    // Monitor exclusivo dos canais HLS. Não altera Kick, MP4 ou iframe.
    private val hlsFreezeMonitor = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized) {
                val active = currentChannel?.type?.equals("hls", ignoreCase = true) == true &&
                    binding.playerView.visibility == View.VISIBLE &&
                    exoPlayer.playWhenReady
                if (active) {
                    val now = SystemClock.elapsedRealtime()
                    val position = exoPlayer.currentPosition
                    if (hlsLastProgressAt == 0L) {
                        hlsLastProgressAt = now
                        hlsLastPositionMs = position
                    } else if (position > hlsLastPositionMs + 250L) {
                        hlsLastPositionMs = position
                        hlsLastProgressAt = now
                        if (now - hlsStartedAt >= 30_000L) hlsRecoveryAttempts = 0
                    } else if (now - hlsLastProgressAt >= 30_000L &&
                        exoPlayer.playbackState == Player.STATE_BUFFERING) {
                        Log.w("TVBOX_HLS", "HLS sem progresso: pos=${position}ms, estado=BUFFERING, url=${currentChannel?.url}")
                        recoverFrozenHls("sem progresso por 30 segundos em BUFFERING")
                    }
                } else {
                    hlsLastPositionMs = C.TIME_UNSET
                    hlsLastProgressAt = 0L
                }
            }
            mainHandler.postDelayed(this, 5_000L)
        }
    }

    private fun recoverFrozenHls(reason: String) {
        val channel = currentChannel ?: return
        if (!channel.type.equals("hls", ignoreCase = true) ||
            binding.playerView.visibility != View.VISIBLE || !exoPlayer.playWhenReady) return

        val now = SystemClock.elapsedRealtime()
        val waitMs = (5_000L * (1L shl hlsRecoveryAttempts.coerceAtMost(4)))
            .coerceAtMost(60_000L)
        if (hlsLastRecoveryAt != 0L && now - hlsLastRecoveryAt < waitMs) return

        hlsLastRecoveryAt = now
        hlsRecoveryAttempts++
        hlsLastProgressAt = now
        hlsLastPositionMs = C.TIME_UNSET
        hlsStartedAt = now
        hlsRecovering = true
        Log.w(
            "TVBOX_HLS",
            "Reabrindo HLS: $reason (tentativa $hlsRecoveryAttempts, pos=${exoPlayer.currentPosition}ms, estado=${exoPlayer.playbackState}, url=${channel.url})"
        )

        exoPlayer.stop()
        playStream(channel.url, showController = false)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        playerTitleOverlay = binding.playerView.findViewById(R.id.player_title_overlay)
        fullscreenButton = binding.playerView.findViewById(R.id.fullscreen_button)
        setupPlayer()
        mainHandler.postDelayed(bannerRotation, 8_000)
        fullscreenButton.setOnClickListener { toggleMobileFullscreen() }
        mainHandler.post(hlsFreezeMonitor)
        setupIFrameWebView()
        setupRecyclerView()
        setupHomeMenu()
        setupSidebar()
        binding.startupRetry.setOnClickListener { loadChannels() }
        loadChannels()
        mainHandler.postDelayed(kickLiveRefresh, 60_000)
    }

    private fun toggleMobileFullscreen() {
        val decor = window.decorView
        val immersive = decor.systemUiVisibility and View.SYSTEM_UI_FLAG_FULLSCREEN != 0
        decor.systemUiVisibility = if (immersive) {
            View.SYSTEM_UI_FLAG_VISIBLE
        } else {
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    private fun setupPlayer() {
        val loadControl = DefaultLoadControl.Builder()
    .setBufferDurationsMs(
        30_000, // Buffer mínimo: 30 segundos
        60_000, // Buffer máximo: 60 segundos
        2_500,  // Para iniciar: 2,5 segundos
        5_000   // Para retomar após travar: 5 segundos
    )
    .build()
        val bootstrapClient = OkHttpClient.Builder().build()
        val doh = DnsOverHttps.Builder()
            .client(bootstrapClient)
            .url("https://dns.google/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("8.8.8.8"),
                InetAddress.getByName("8.8.4.4")
            )
            .build()
        val httpClient = OkHttpClient.Builder()
            .dns(doh)
            .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
        val httpDataSourceFactory = OkHttpDataSource.Factory(httpClient)
            .setUserAgent("Mozilla/5.0 (Android; TVBox) AppleWebKit/537.36")
        val defaultHlsExtractorFactory = DefaultHlsExtractorFactory()
        hlsMediaSourceFactory = HlsMediaSource.Factory(httpDataSourceFactory)
            .setExtractorFactory(object : HlsExtractorFactory {
                override fun createExtractor(
                    uri: Uri,
                    format: androidx.media3.common.Format,
                    muxedCaptionFormats: List<androidx.media3.common.Format>?,
                    timestampAdjuster: androidx.media3.common.util.TimestampAdjuster,
                    responseHeaders: Map<String, List<String>>,
                    extractorInput: androidx.media3.extractor.ExtractorInput,
                    playerId: androidx.media3.exoplayer.analytics.PlayerId
                ): HlsMediaChunkExtractor {
                    val path = uri.path.orEmpty()
                    val extractorUri = if (path.endsWith(".png", ignoreCase = true)) {
                        uri.buildUpon().path(path.replace(Regex("(?i)\\.png$"), ".ts")).build()
                    } else {
                        uri
                    }
                    return defaultHlsExtractorFactory.createExtractor(
                        extractorUri,
                        format,
                        muxedCaptionFormats,
                        timestampAdjuster,
                        responseHeaders,
                        extractorInput,
                        playerId
                    )
                }
            })
       exoPlayer = ExoPlayer.Builder(this)
    .setMediaSourceFactory(DefaultMediaSourceFactory(httpDataSourceFactory))
    .setLoadControl(loadControl)
    .build()
        binding.playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
            // O título e o botão de tela cheia acompanham a overlay do player.
            // Ao ocultar os controles, ambos somem junto; ao sair do player,
            // nunca devem reaparecer sobre as telas de catálogo.
            val overlayVisible = visibility == View.VISIBLE && binding.playerView.visibility == View.VISIBLE
            fullscreenButton.visibility = if (overlayVisible) View.VISIBLE else View.GONE
            playerTitleOverlay.visibility = if (overlayVisible) View.VISIBLE else View.GONE
        })
        exoPlayer.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true
        )
        exoPlayer.volume = 1f
        binding.playerView.player = exoPlayer
        binding.playerView.setControllerAutoShow(true)
        binding.playerView.setControllerHideOnTouch(true)
        binding.playerView.setControllerShowTimeoutMs(1800)
        mainHandler.post(playbackWatchdog)
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
    Log.e(
        "TVBOX_PLAYER",
        "Falha no player: codigo=${error.errorCodeName}, mensagem=${error.message}",
        error
    )
    if (currentChannel?.type?.equals("hls", ignoreCase = true) == true) {
        recoverFrozenHls("erro do player: ${error.errorCodeName}")
    } else {
        refreshCurrentStream("erro do player: ${error.errorCodeName}", error)
    }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
    if (currentChannel?.type?.equals("hls", ignoreCase = true) == true) {
        val state = when (playbackState) {
            Player.STATE_IDLE -> "IDLE"
            Player.STATE_BUFFERING -> "BUFFERING"
            Player.STATE_READY -> "READY"
            Player.STATE_ENDED -> "ENDED"
            else -> "UNKNOWN($playbackState)"
        }
        Log.i("TVBOX_HLS", "Estado do player: $state")
    }
    when (playbackState) {
        Player.STATE_BUFFERING -> {
            bufferingStartedAt = SystemClock.elapsedRealtime()
        }

        Player.STATE_READY -> {
            streamReloadAttempts = 0
            bufferingStartedAt = 0L
        }

        Player.STATE_ENDED -> {
            bufferingStartedAt = 0L

            // Reiniciar automaticamente somente canais HLS
            if (currentChannel?.type.equals("hls", ignoreCase = true)) {
                Log.w(
                    "TVBOX_HLS",
                    "Live HLS terminou. Reabrindo transmissão..."
                )

                mainHandler.postDelayed({
                    val channel = currentChannel

                    if (
                        channel?.type.equals("hls", ignoreCase = true) &&
                        exoPlayer.playbackState == Player.STATE_ENDED
                    ) {
                        exoPlayer.stop()
                        playStream(channel!!.url)
                    }
                }, 1500L)
            }
        }

        else -> {
            bufferingStartedAt = 0L
        }
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

    private fun setupHomeCatalogs() {
        binding.homeMoviesRow.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        binding.homeSeriesRow.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        binding.homeMatchesRecycler.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        homeMovieAdapter = MediaCardAdapter(emptyList(), onClick = { channel -> playChannel(channel) }, progressProvider = ::cardProgress)
        homeSeriesAdapter = MediaCardAdapter(emptyList(), onClick = { channel ->
    // 1. Oculta a página inicial / menus anteriores se necessário
    binding.homeMenu.visibility = View.GONE
    binding.seriesGridPanel.visibility = View.GONE // Se houver grid geral aberto
    
    // 2. Chama a função que carrega e exibe o painel/grid de episódios
    openSeriesEpisodes(channel.url, channel.name, channel.poster)
}, progressProvider = ::cardProgress)
        binding.homeMoviesRow.adapter = homeMovieAdapter
        binding.homeSeriesRow.adapter = homeSeriesAdapter
        homeMatchesAdapter = TodayMatchAdapter(emptyList()) { match ->
            match.apiUrl?.takeIf { it.isNotBlank() }?.let { streamUrl ->
                playChannel(
                    Channel(
                        name = "${match.homeName} x ${match.awayName}",
                        url = streamUrl,
                        type = "hls",
                        category = "futebol",
                        poster = match.homeImage ?: match.awayImage
                    )
                )
            }
        }
        binding.homeRecentRow.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        homeRecentAdapter = MediaCardAdapter(emptyList(), onClick = { channel -> playChannel(channel) }, progressProvider = ::cardProgress)
        binding.homeRecentRow.adapter = homeRecentAdapter
        binding.homeMatchesRecycler.adapter = homeMatchesAdapter

       binding.seriesGrid.layoutManager = GridLayoutManager(this, resources.getInteger(R.integer.catalog_columns))

val spacing = dp(14)

binding.seriesGrid.addItemDecoration(
    object : RecyclerView.ItemDecoration() {
        override fun getItemOffsets(
            outRect: Rect,
            view: View,
            parent: RecyclerView,
            state: RecyclerView.State
        ) {
            outRect.set(
                spacing / 2,
                spacing / 2,
                spacing / 2,
                spacing / 2
            )
        }
    }
)


        seriesGridAdapter = MediaCardAdapter(emptyList(), gridMode = true, onClick = { channel ->
            openSeriesEpisodes(channel.url, channel.name, channel.poster)
        }, progressProvider = ::cardProgress)
        binding.seriesGrid.adapter = seriesGridAdapter
        
binding.episodesGrid.layoutManager = GridLayoutManager(this, resources.getInteger(R.integer.catalog_columns))

val episodeSpacing = dp(14)

binding.episodesGrid.addItemDecoration(
    object : RecyclerView.ItemDecoration() {
        override fun getItemOffsets(
            outRect: Rect,
            view: View,
            parent: RecyclerView,
            state: RecyclerView.State
        ) {
            outRect.set(
                episodeSpacing / 2,
                episodeSpacing / 2,
                episodeSpacing / 2,
                episodeSpacing / 2
            )
        }
    }
)

episodesGridAdapter = MediaCardAdapter(emptyList(), gridMode = true, onClick = { episode ->
    playChannel(episode)
}, progressProvider = ::cardProgress)

binding.episodesGrid.adapter = episodesGridAdapter

        binding.catalogGrid.layoutManager = GridLayoutManager(this, resources.getInteger(R.integer.catalog_columns))
        binding.catalogGrid.addItemDecoration(
            object : RecyclerView.ItemDecoration() {
                override fun getItemOffsets(outRect: Rect, view: View, parent: RecyclerView, state: RecyclerView.State) {
                    val gridSpacing = dp(14) / 2
                    outRect.set(gridSpacing, gridSpacing, gridSpacing, gridSpacing)
                }
            }
        )
        catalogGridAdapter = MediaCardAdapter(emptyList(), gridMode = true, onClick = { channel -> playChannel(channel) }, progressProvider = ::cardProgress)
        binding.catalogGrid.adapter = catalogGridAdapter

    }

    private fun setupHomeMenu() {
        binding.homeVersion.text = "Micael Farias  •  Versão ${BuildConfig.VERSION_NAME}"
        binding.homeHome.setOnClickListener { showHomeMenu() }
        binding.homeFootball.setOnClickListener { refreshAndOpenCategory("futebol") }
        binding.homeKick.setOnClickListener { refreshAndOpenCategory("kick") }
        binding.homeMovies.setOnClickListener { refreshAndOpenCategory("filmes") }
        binding.homeSeries.setOnClickListener { refreshAndOpenCategory("series") }
        binding.homeKickLiveRecycler.layoutManager =
            LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        kickLiveAdapter = KickLiveAdapter(emptyList()) { live ->
            val hls = live.playbackUrl
            if (!hls.isNullOrBlank()) {
                currentChannel = Channel(
                    name = live.name,
                    url = live.playbackEndpoint ?: "",
                    type = "kick",
                    category = "kick",
                    poster = live.poster
                )
                // Salva a URL HLS já resolvida para que "Recentes" reproduza
                // diretamente no tablet, sem abrir a página da Kick.
                recordRecentlyWatched(currentChannel!!.copy(url = hls, type = "hls"))
                playerReturnScreen = "home"
                showPlayerTitle(currentChannel!!)
                playerReturnWasHome = true
                playerReturnWasChannels = false
                streamReloadAttempts = 0
                playStream(hls)
            } else {
                Toast.makeText(this, "Transmissão indisponível", Toast.LENGTH_SHORT).show()
            }
        }
        binding.homeKickLiveRecycler.adapter = kickLiveAdapter
        binding.homeUpdate.setOnClickListener { checkForUpdate() }
        setupHomeCatalogs()

        // No controle remoto, entra diretamente no primeiro card visível.
        binding.homeHome.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && event.action == KeyEvent.ACTION_DOWN) {
                focusFirstHomeContent()
                true
            } else false
        }
        binding.homeMovies.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && event.action == KeyEvent.ACTION_DOWN) {
                focusHomeCard(binding.homeMoviesRow)
                true
            } else false
        }
        binding.homeSeries.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && event.action == KeyEvent.ACTION_DOWN) {
                focusFirstHomeContent()
                true
            } else false
        }
    }

    private fun focusFirstHomeContent() {
        if (binding.homeHeroBanner.visibility == View.VISIBLE) {
            binding.homeMenu.smoothScrollTo(0, 0)
            binding.homeHeroPlay.requestFocus()
            return
        }
        val rows = listOf(binding.homeMatchesRecycler, binding.homeKickLiveRecycler, binding.homeRecentRow) +
            (0 until binding.homeDynamicSections.childCount).mapNotNull { binding.homeDynamicSections.getChildAt(it) as? RecyclerView }
        rows.firstOrNull { it.isShown && (it.adapter?.itemCount ?: 0) > 0 }?.let(::focusHomeCard)
    }

    private fun focusHomeCard(row: RecyclerView) {
        if (row.visibility != View.VISIBLE) {
            val firstRow = binding.homeDynamicSections.getChildAt(1) as? RecyclerView
            if (firstRow != null) {
                firstRow.requestFocus()
                firstRow.post { firstRow.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            }
            return
        }
        row.requestFocus()
        row.post {
            row.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus()
        }
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
        // O catálogo só é baixado na abertura do app. Assim voltar para Filmes,
        // Séries ou Futebol mantém a lista e a posição já carregadas.
        if (allChannels.isNotEmpty()) openCategory(category)
        else loadChannels { openCategory(category) }
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

        showCatalogGrid(category.uppercase(), channels)
    }

    /** Primeiro nível do Futebol: campeonatos/dias; segundo: jogos/canais. */
    private fun openFootballCatalog() {
        val football = allChannels.filter { channelCategory(it) == "futebol" }
        if (football.isEmpty()) {
            Toast.makeText(this, "Nenhum jogo ou canal de futebol encontrado", Toast.LENGTH_SHORT).show()
            return
        }

        footballGroups.clear()
        football.flatMap { item -> itemCategories(item).ifEmpty { listOf("AO VIVO") }.map { it.uppercase() to item } }.groupBy({ it.first }, { it.second })
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .forEach { (label, channels) ->
                footballGroups[label] = channels.sortedBy { it.name.lowercase() }
            }

        footballGroupMenuOpen = false
        val groups = footballGroups.map { (label, channels) ->
            Channel(
                name = "$label  (${channels.size})",
                url = label,
                type = "football-group",
                category = "futebol",
                poster = channels.mapNotNull { it.poster }.firstOrNull()
            )
        }
        showCatalogGrid("FUTEBOL", groups)
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
        showCatalogGrid(groupId.uppercase(), channels)
    }

    /** Primeiro nÃ­vel dos filmes: categorias recebidas do catÃ¡logo. */
    private fun openMovieCatalog() {
        val movies = allChannels.filter { channelCategory(it) == "filmes" }
        if (movies.isEmpty()) {
            Toast.makeText(this, "Nenhum filme encontrado", Toast.LENGTH_SHORT).show()
            return
        }

        movieGroups.clear()
        movies.flatMap { item -> itemCategories(item).ifEmpty { listOf("FILMES") }.map { it.uppercase() to item } }.groupBy({ it.first }, { it.second })
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .forEach { (label, channels) ->
                movieGroups[label] = channels.sortedBy { it.name.lowercase() }
            }

        movieCategoryMenuOpen = false
        val groups = movieGroups.map { (label, channels) ->
            Channel(
                name = "$label  (${channels.size})",
                url = label,
                type = "movie-group",
                category = "filmes",
                poster = channels.mapNotNull { it.poster }.firstOrNull()
            )
        }
        showCatalogGrid("FILMES", groups)
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
        showCatalogGrid(categoryId.uppercase(), movies)
    }

    private fun itemCategories(channel: Channel): List<String> =
        (listOfNotNull(channel.category) + channel.categories.orEmpty()).filter { it.isNotBlank() }.distinct()

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

    /** Catálogos em tela cheia: filmes, canais e grupos usam o mesmo grid das séries. */
    private fun showCatalogGrid(title: String, items: List<Channel>) {
        binding.homeMenu.visibility = View.GONE
        binding.channelPanel.visibility = View.GONE
        binding.seriesGridPanel.visibility = View.GONE
        binding.episodesGridPanel.visibility = View.GONE
        binding.sidebar.visibility = View.GONE
        binding.catalogGridTitle.text = "$title (${items.size})"
        catalogGridAdapter.submit(items)
        binding.catalogGridPanel.visibility = View.VISIBLE
        binding.catalogGrid.scrollToPosition(0)
        binding.catalogGrid.post {
            (binding.catalogGrid.findViewHolderForAdapterPosition(0)?.itemView
                ?: binding.catalogGrid).requestFocus()
        }
    }

    private fun showHomeMenu() {
        exoPlayer.pause()
        binding.iframeWebView.stopLoading()
        binding.iframeWebView.visibility = View.GONE
        binding.playerView.visibility = View.GONE
        binding.channelPanel.visibility = View.GONE
        binding.catalogGridPanel.visibility = View.GONE
        binding.seriesGridPanel.visibility = View.GONE
        binding.sidebar.visibility = View.VISIBLE
        binding.homeMenu.visibility = View.VISIBLE
        binding.episodesGridPanel.visibility = View.GONE
        seriesEpisodeMenuOpen = false
        if (!initialCatalogLoaded) loadChannels()
        else { loadRecentItems(); renderRecentItems() }
        binding.homeHome.requestFocus()
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
        binding.channelPanel.visibility = View.GONE
        binding.catalogGridPanel.visibility = View.GONE
        binding.sidebar.visibility = View.GONE
        val series = seriesCatalogEntries.mapNotNull { entry ->
            val endpoint = entry.endpoint ?: entry.url ?: return@mapNotNull null
            val title = entry.title ?: entry.name ?: entry.id ?: return@mapNotNull null
            Channel(name = title, url = endpoint, type = "series-group", category = "series", series = title, poster = entry.poster)
        }.sortedBy { it.name.lowercase() }
        binding.seriesGridTitle.text = "SÉRIES (${series.size})"
        seriesGridAdapter.submit(series)
        binding.seriesGridPanel.visibility = View.VISIBLE
        binding.seriesGrid.post {
            (binding.seriesGrid.findViewHolderForAdapterPosition(0)?.itemView
                ?: binding.seriesGrid).requestFocus()
        }
    }


private fun openSeriesEpisodes(
    endpoint: String,
    fallbackTitle: String,
    fallbackPoster: String? = null
) {
    Toast.makeText(this, "Carregando episódios...", Toast.LENGTH_SHORT).show()

    lifecycleScope.launch(Dispatchers.IO) {
        val url = if (
            endpoint.startsWith("http://") ||
            endpoint.startsWith("https://")
        ) {
            endpoint
        } else {
            "http://164.152.62.129/${endpoint.trimStart('/')}"
        }

        val details = try {
            val request = Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .build()

            OkHttpClient().newCall(request).execute().use { response ->
                val body = response.body?.string()

                if (!response.isSuccessful || body.isNullOrBlank()) {
                    null
                } else {
                    Gson().fromJson(body, SeriesDetails::class.java)
                }
            }
        } catch (e: Exception) {
            null
        }

        val seriesName = details?.title ?: fallbackTitle

        val episodes = details?.seasons.orEmpty()
            .flatMap { season ->
                season.episodes.orEmpty().mapIndexed { index, episode ->
                    Channel(
                        name = episode.title
                            ?: episode.name
                            ?: "Episódio ${episode.number ?: episode.episode ?: index + 1}",
                        url = episode.url.orEmpty(),
                        type = episode.type ?: "mp4",
                        category = "series",
                        series = seriesName,
                        season = season.number ?: season.season,
                        episode = episode.number ?: episode.episode ?: index + 1,
                        poster = details?.poster ?: fallbackPoster
                    )
                }
            }
            .filter { it.url.isNotBlank() }
            .sortedWith(
                compareBy<Channel> { it.season ?: 0 }
                    .thenBy { it.episode ?: Int.MAX_VALUE }
            )

        withContext(Dispatchers.Main) {
            if (episodes.isEmpty()) {
                Toast.makeText(
                    this@MainActivity,
                    "Nenhum episódio encontrado",
                    Toast.LENGTH_SHORT
                ).show()
                return@withContext
            }

            activeSeriesName = seriesName
            activeSeriesEpisodes = episodes
            activeSeriesSeason = episodes.firstOrNull()?.season ?: 1
            activeSeriesEpisodeIndex =
                lastWatchedSeriesEpisodeIndex(seriesName, episodes)

            seriesEpisodeMenuOpen = true

            binding.homeMenu.visibility = View.GONE
            binding.seriesGridPanel.visibility = View.GONE
            binding.channelPanel.visibility = View.GONE
            binding.catalogGridPanel.visibility = View.GONE
            binding.sidebar.visibility = View.GONE
            binding.episodesGridPanel.visibility = View.VISIBLE

            binding.episodesGridTitle.text =
                "${seriesName.uppercase()} • ${episodes.size} EPISÓDIOS"

            val seasons = episodes.map { it.season ?: 1 }.distinct().sorted()
            binding.seasonSelector.adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_item,
                seasons.map { "Temporada $it" }
            ).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            binding.seasonSelector.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    activeSeriesSeason = seasons.getOrNull(position) ?: 1
                    val filtered = activeSeriesEpisodes.filter { (it.season ?: 1) == activeSeriesSeason }
                    episodesGridAdapter.submit(filtered.mapIndexed { index, episode -> episode.copy(name = episodeMenuLabel(episode, index)) })
                }
            }
            binding.seasonSelector.setSelection(seasons.indexOf(activeSeriesSeason).coerceAtLeast(0))

            binding.episodesGrid.scrollToPosition(activeSeriesEpisodeIndex)

            binding.episodesGrid.post {
                (
                    binding.episodesGrid
                        .findViewHolderForAdapterPosition(activeSeriesEpisodeIndex)
                        ?.itemView
                        ?: binding.episodesGrid
                ).requestFocus()
            }
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

    private fun setupSidebar() {
        val labels = listOf(
            Triple(binding.homeHome, "⌂", "Início"), Triple(binding.homeMovies, "▣", "Filmes"),
            Triple(binding.homeSeries, "▤", "Séries"), Triple(binding.homeFootball, "●", "Ao vivo"),
            Triple(binding.homeKick, "▶", "Kick"), Triple(binding.homeUpdate, "↻", "Atualizar")
        )
        labels.forEach { (view, _, label) ->
            view.contentDescription = label
            androidx.appcompat.widget.TooltipCompat.setTooltipText(view, label)
        }
        binding.root.viewTreeObserver.addOnGlobalFocusChangeListener(sidebarFocusListener)
        updateSidebar(binding.sidebar.hasFocus())
    }

    private fun updateSidebar(expanded: Boolean) {
        if (sidebarExpanded == expanded) return
        sidebarExpanded = expanded
        binding.sidebar.layoutParams = binding.sidebar.layoutParams.apply {
            width = if (expanded) resources.getDimensionPixelSize(R.dimen.nav_width) else dp(64)
        }
        binding.sidebarBrand.visibility = if (expanded) View.VISIBLE else View.GONE
        binding.homeVersion.visibility = if (expanded) View.VISIBLE else View.GONE
        binding.sidebarLogo.layoutParams = binding.sidebarLogo.layoutParams.apply { height = dp(if (expanded) 76 else 48) }
        listOf(
            Triple(binding.homeHome, "⌂", "Início"), Triple(binding.homeMovies, "▣", "Filmes"),
            Triple(binding.homeSeries, "▤", "Séries"), Triple(binding.homeFootball, "●", "Ao vivo"),
            Triple(binding.homeKick, "▶", "Kick"), Triple(binding.homeUpdate, "↻", "Atualizar")
        ).forEach { (view, icon, label) ->
            view.text = if (expanded) "$icon  $label" else icon
            view.textSize = if (expanded) resources.getDimension(R.dimen.nav_text_size) / resources.displayMetrics.scaledDensity else 22f
        }
    }

    private fun showStartupLoading() {
        binding.startupOverlay.visibility = View.VISIBLE
        binding.startupProgress.visibility = View.VISIBLE
        binding.startupRetry.visibility = View.GONE
        binding.startupStatus.text = "Preparando seu cinema…"
        binding.startupOverlay.requestFocus()
        startupAnimator?.cancel()
        val pulse = android.animation.ObjectAnimator.ofFloat(binding.startupLogo, View.ALPHA, 0.45f, 1f).apply {
            duration = 950
            repeatCount = android.animation.ValueAnimator.INFINITE
            repeatMode = android.animation.ValueAnimator.REVERSE
        }
        startupAnimator = android.animation.AnimatorSet().apply { play(pulse); start() }
    }

    private fun finishStartup(error: String? = null) {
        startupAnimator?.cancel()
        binding.startupLogo.alpha = 1f
        if (error == null) {
            binding.startupOverlay.visibility = View.GONE
        } else {
            binding.startupProgress.visibility = View.GONE
            binding.startupStatus.text = error
            binding.startupRetry.visibility = View.VISIBLE
            binding.startupRetry.requestFocus()
        }
    }

    private fun loadChannels(onLoaded: (() -> Unit)? = null) {
        if (channelsLoading) return
        channelsLoading = true
        if (!initialCatalogLoaded) showStartupLoading()
        else if (onLoaded != null) Toast.makeText(this, "Atualizando catálogo...", Toast.LENGTH_SHORT).show()
        val channelsUrl = "$TVBOX_API_BASE/channels?t=${System.currentTimeMillis()}"

        lifecycleScope.launch(Dispatchers.IO) {
            val client = OkHttpClient.Builder().callTimeout(20, java.util.concurrent.TimeUnit.SECONDS).build()
            val result = runCatching {
                val channels = fetchRawChannels(client, channelsUrl)
                val series = fetchSeriesCatalog(client, "$TVBOX_API_BASE/series?t=${System.currentTimeMillis()}")
                val home = fetchHomeConfig(client, "$TVBOX_API_BASE/home?t=${System.currentTimeMillis()}")
                Triple(channels, series, home)
            }
            withContext(Dispatchers.Main) {
                channelsLoading = false
                val data = result.getOrNull()
                if (data == null) {
                    Log.w("CINEDARK_CATALOG", "Falha ao carregar catálogo", result.exceptionOrNull())
                    if (!initialCatalogLoaded) finishStartup("Não foi possível carregar o catálogo. Verifique a conexão e tente novamente.")
                    else Toast.makeText(this@MainActivity, "Não foi possível atualizar. Seu catálogo atual foi mantido.", Toast.LENGTH_LONG).show()
                    return@withContext
                }
                allChannels = data.first
                seriesCatalogEntries = data.second
                homeSections = data.third?.sections.orEmpty()
                homeBanners = data.third?.banners.orEmpty()
                initialCatalogLoaded = true
                updateHomeCatalogs()
                finishStartup()
                if (onLoaded == null) showHomeMenu() else onLoaded()
            }
        }
    }

    private fun updateHomeCatalogs() {
        loadRecentItems()
        renderRecentItems()
        renderConfiguredHomeSections()
        // As fileiras dinâmicas abaixo substituem o layout antigo e evitam
        // conteúdo duplicado. Mantemos os adapters antigos para compatibilidade.
        binding.homeMoviesRow.visibility = View.GONE
        binding.homeSeriesRow.visibility = View.GONE
        binding.homeMoviesTitle.visibility = View.GONE
        binding.homeSeriesTitle.visibility = View.GONE
        binding.homeMoviesEmpty.visibility = View.GONE
        binding.homeSeriesEmpty.visibility = View.GONE
        val movies = allChannels.filter { channelCategory(it) == "filmes" }.take(18)
        val series = seriesCatalogEntries.mapNotNull { entry ->
            val endpoint = entry.endpoint ?: entry.url ?: return@mapNotNull null
            val title = entry.title ?: entry.name ?: entry.id ?: return@mapNotNull null
            Channel(title, endpoint, "series-group", "series", poster = entry.poster, series = title)
        }.take(18)
        homeMovieAdapter.submit(movies)
        homeSeriesAdapter.submit(series)
        configureBanners(movies + series)
        binding.homeMoviesEmpty.visibility = if (movies.isEmpty()) View.VISIBLE else View.GONE
        binding.homeSeriesEmpty.visibility = if (series.isEmpty()) View.VISIBLE else View.GONE
        binding.homeMoviesEmpty.visibility = View.GONE
        binding.homeSeriesEmpty.visibility = View.GONE

        binding.homeKickLiveCarousel.visibility = View.GONE
        loadKickLiveChannels()
        loadTodayBrazilianMatches()

    }

    private fun configureBanners(fallback: List<Channel>) {
        val series = seriesCatalogEntries.mapNotNull { entry ->
            val endpoint = entry.endpoint ?: entry.url ?: return@mapNotNull null
            Channel(entry.title ?: entry.name ?: entry.id.orEmpty(), endpoint, "series-group", "series",
                poster = entry.poster, series = entry.title ?: entry.name, id = entry.id)
        }
        bannerSlides = if (homeBanners.isNotEmpty()) homeBanners.filter { it.enabled != false }.mapNotNull { banner ->
            val target = banner.target.orEmpty()
            val channel = if (target.startsWith("series:")) series.firstOrNull { it.id == target.removePrefix("series:") }
                else allChannels.firstOrNull { it.id == target.removePrefix("item:") }
            channel?.let { BannerSlide(it, banner.title?.takeIf(String::isNotBlank) ?: it.name,
                banner.subtitle.orEmpty(), banner.image?.takeIf(String::isNotBlank) ?: it.backdrop ?: it.poster) }
        } else fallback.filter { !it.poster.isNullOrBlank() }.take(6).map {
            BannerSlide(it, it.name, if (it.type == "series-group") "Série • Explore temporadas e episódios" else "Na sua seleção CINEDARK", it.backdrop ?: it.poster)
        }
        binding.homeHeroBanner.visibility = if (bannerSlides.isEmpty()) View.GONE else View.VISIBLE
        binding.homeHeroPrevious.setOnClickListener { selectBanner(bannerIndex - 1) }
        binding.homeHeroNext.setOnClickListener { selectBanner(bannerIndex + 1) }
        binding.homeHeroPlay.setOnClickListener { bannerSlides.getOrNull(bannerIndex)?.let { playChannel(it.channel) } }
        binding.homeHeroPlay.setOnKeyListener { _, key, event ->
            if (event.action == KeyEvent.ACTION_DOWN && key == KeyEvent.KEYCODE_DPAD_LEFT) {
                binding.homeHome.requestFocus()
                true
            } else if (event.action == KeyEvent.ACTION_DOWN && bannerSlides.size > 1 && key == KeyEvent.KEYCODE_DPAD_RIGHT) {
                selectBanner(bannerIndex + 1)
                true
            } else false
        }
        if (bannerSlides.isNotEmpty()) selectBanner(bannerIndex)
    }

    private fun selectBanner(index: Int) {
        if (bannerSlides.isEmpty()) return
        bannerIndex = ((index % bannerSlides.size) + bannerSlides.size) % bannerSlides.size
        val slide = bannerSlides[bannerIndex]
        binding.homeHeroTitle.text = slide.title
        binding.homeHeroMeta.text = slide.subtitle
        // A imagem escolhida no painel ocupa o fundo; uma capa comum
        // permanece ao lado do texto enquanto suas dimensões são carregadas.
        setBannerImageMode(!slide.image.isNullOrBlank() && slide.image != slide.channel.poster)
        binding.homeHeroBackdrop.load(slide.image) {
            crossfade(true)
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
            listener(onSuccess = { _, result ->
                if (bannerSlides.getOrNull(bannerIndex) == slide) {
                    val image = result.drawable
                    setBannerImageMode(image.intrinsicWidth > image.intrinsicHeight)
                }
            }, onError = { _, _ ->
                if (bannerSlides.getOrNull(bannerIndex) == slide) setBannerImageMode(false)
            })
        }
        binding.homeHeroBadge.text = "SELEÇÃO CINEDARK • ${bannerIndex + 1}/${bannerSlides.size}"
        binding.homeHeroPrevious.visibility = if (bannerSlides.size > 1) View.VISIBLE else View.GONE
        binding.homeHeroNext.visibility = if (bannerSlides.size > 1) View.VISIBLE else View.GONE
    }

    private fun setBannerImageMode(horizontal: Boolean) {
        binding.homeHeroShade.visibility = if (horizontal) View.VISIBLE else View.GONE
        binding.homeHeroBackdrop.scaleType = if (horizontal) android.widget.ImageView.ScaleType.CENTER_CROP
            else android.widget.ImageView.ScaleType.FIT_CENTER
        binding.homeHeroBackdrop.layoutParams = android.widget.FrameLayout.LayoutParams(
            if (horizontal) android.view.ViewGroup.LayoutParams.MATCH_PARENT else resources.getDimensionPixelSize(R.dimen.hero_poster_width),
            if (horizontal) android.view.ViewGroup.LayoutParams.MATCH_PARENT else resources.getDimensionPixelSize(R.dimen.hero_height),
            Gravity.END or Gravity.CENTER_VERTICAL
        ).apply {
            if (!horizontal) { marginEnd = dp(16); topMargin = dp(12); bottomMargin = dp(12) }
        }
        val textEnd = if (horizontal) {
            if (resources.configuration.screenWidthDp >= 600) dp(180) else dp(20)
        } else resources.getDimensionPixelSize(R.dimen.hero_poster_width) + dp(32)
        binding.homeHeroContent.setPaddingRelative(dp(20), dp(20), textEnd, dp(20))
        binding.homeHeroTitle.setShadowLayer(dp(3).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
        binding.homeHeroMeta.setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
    }

    private fun loadRecentItems() {
        recentItems = try {
            val json = getSharedPreferences(recentPrefsName, MODE_PRIVATE).getString(recentKey, "[]") ?: "[]"
            Gson().fromJson<List<Channel>>(json, object : TypeToken<List<Channel>>() {}.type) ?: emptyList()
        } catch (_: Exception) { emptyList() }
    }

    private fun renderRecentItems() {
        if (!::homeRecentAdapter.isInitialized) return
        val items = recentItems.take(12)
        homeRecentAdapter.submit(items)
        binding.homeRecentTitle.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
        binding.homeRecentRow.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun recordRecentlyWatched(channel: Channel) {
        if (channel.url.isBlank() ||
            channel.type.equals("movie-group", true) || channel.type.equals("football-group", true)) return
        // Episódios entram como a série inteira, nunca como itens individuais.
        val recentChannel = if (channel.series?.isNotBlank() == true &&
            !channel.type.equals("series-group", true)) {
            val seriesName = channel.series!!.trim()
            val entry = seriesCatalogEntries.firstOrNull {
                (it.title ?: it.name).orEmpty().equals(seriesName, true)
            }
            Channel(
                name = seriesName,
                url = entry?.endpoint ?: entry?.url ?: channel.url,
                type = "series-group",
                category = "series",
                poster = entry?.poster ?: channel.poster,
                series = seriesName
            )
        } else channel
        recentItems = listOf(recentChannel) + recentItems.filterNot {
            it.name.equals(recentChannel.name, true) &&
                (it.series ?: "").equals(recentChannel.series ?: "", true)
        }
        recentItems = recentItems.take(12)
        getSharedPreferences(recentPrefsName, MODE_PRIVATE).edit()
            .putString(recentKey, Gson().toJson(recentItems)).apply()
        if (binding.homeMenu.visibility == View.VISIBLE) renderRecentItems()
    }

    private fun loadKickLiveChannels() {
        if (kickLiveLoading || !::kickLiveAdapter.isInitialized) return
        val showKick = homeSections.isEmpty() ||
            homeSections.any { it.type == "kick-live" && it.enabled != false }
        if (!showKick) {
            binding.homeKickLiveCarousel.visibility = View.GONE
            return
        }
        kickLiveLoading = true
        lifecycleScope.launch(Dispatchers.IO) {
            val result = try {
                val request = Request.Builder()
                    .url("$TVBOX_API_BASE/kick/live")
                    .header("Accept", "application/json")
                    .build()
                kickLiveClient.newCall(request).execute().use { response ->
                    val body = response.body?.string()
                    if (!response.isSuccessful || body.isNullOrBlank()) null
                    else Gson().fromJson(body, KickLiveResponse::class.java)
                }
            } catch (error: Exception) {
                Log.w("TVBOX_KICK", "Falha ao consultar canais ao vivo", error)
                null
            }
            withContext(Dispatchers.Main) {
                kickLiveLoading = false
                if (result != null) {
                    val online = result.channels.orEmpty().filter { it.isLive }
                    kickLiveAdapter.submit(online)
                    binding.homeKickLiveCarousel.visibility =
                        if (online.isEmpty()) View.GONE else View.VISIBLE
                }
            }
        }
    }

    private fun loadTodayBrazilianMatches() {
        lifecycleScope.launch(Dispatchers.IO) {
            val response = try {
                val request = Request.Builder()
                    .url("$TVBOX_API_BASE/embedtv/events")
                    .header("Accept", "application/json")
                    .build()
                OkHttpClient().newCall(request).execute().use { httpResponse ->
                    val body = httpResponse.body?.string()
                    if (!httpResponse.isSuccessful || body.isNullOrBlank()) null
                    else Gson().fromJson(body, EmbedEventsResponse::class.java)
                }
            } catch (error: Exception) {
                Log.w("TVBOX_EVENTS", "Falha ao consultar jogos do Brasileirão", error)
                null
            }

            val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val games = response?.events.orEmpty()
                .filter { it.time_start?.substringBefore("T") == today }
                .filter {
                    val league = it.league?.name.orEmpty().lowercase(Locale.ROOT)
                    league.contains("brasileir") || league.contains("libertadores") ||
                        league.contains("sul-americana") || league.contains("sulamericana")
                }
                .map { event ->
                    val home = event.teams?.home
                    val away = event.teams?.away
                    TodayMatch(
                        homeName = home?.name?.takeIf { it.isNotBlank() } ?: "Casa",
                        homeImage = home?.image,
                        awayName = away?.name?.takeIf { it.isNotBlank() } ?: "Visitante",
                        awayImage = away?.image,
                        leagueName = event.league?.name,
                        leagueImage = event.league?.image,
                        time = event.time_start?.substringAfter("T")?.take(5) ?: "--:--",
                        apiUrl = event.players.firstOrNull { it.status == "online" }?.apiUrl
                            ?: event.players.firstOrNull()?.apiUrl
                    )
                }

            withContext(Dispatchers.Main) {
                homeMatchesAdapter.submit(games)
                binding.homeMatchesCarousel.visibility = if (games.isEmpty()) View.GONE else View.VISIBLE
            }
        }
    }

    private fun renderConfiguredHomeSections() {
        val container = binding.homeDynamicSections
        container.removeAllViews()
        val sections = if (homeSections.isEmpty()) listOf(
            HomeSection("movies", "category", "Filmes em destaque", "filmes", true, 18),
            HomeSection("series", "series", "Séries", null, true, 18)
        ) else homeSections.filter { it.enabled != false }

        sections.filter { it.type != "kick-live" }.forEach { section ->
            val limit = (section.limit ?: 18).coerceIn(1, 40)
            val isSeries = section.type == "series"
            val items = if (isSeries) {
                seriesCatalogEntries.mapNotNull { entry ->
                    val endpoint = entry.endpoint ?: entry.url ?: return@mapNotNull null
                    val title = entry.title ?: entry.name ?: entry.id ?: return@mapNotNull null
                    Channel(title, endpoint, "series-group", "series", poster = entry.poster, series = title)
                }.take(limit)
            } else {
                val category = section.category.orEmpty().trim()
                allChannels.filter { itemCategories(it).any { value -> value.equals(category, ignoreCase = true) } || channelCategory(it).equals(category, true) }.take(limit)
            }
            if (items.isEmpty()) return@forEach
            val title = TextView(this).apply {
                text = (section.title ?: section.category ?: if (isSeries) "SÉRIES" else "CATÁLOGO").uppercase()
                setTextColor(Color.WHITE)
                textSize = 17f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(0, 28, 0, 10)
            }
            val row = RecyclerView(this).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(206))
                layoutManager = LinearLayoutManager(this@MainActivity, RecyclerView.HORIZONTAL, false)
                isNestedScrollingEnabled = false
                adapter = MediaCardAdapter(items, onClick = { channel ->
                    if (channel.type == "series-group") openSeriesEpisodes(channel.url, channel.name, channel.poster)
                    else playChannel(channel)
                }, progressProvider = ::cardProgress)
            }
            container.addView(title)
            container.addView(row)
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun fetchRawChannels(client: OkHttpClient, url: String): List<Channel> {
        val request = Request.Builder().url(url).header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Android; CINEDARK)").build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw java.io.IOException("Catálogo HTTP ${response.code}")
            val body = response.body?.string()?.takeIf { it.isNotBlank() }
                ?: throw java.io.IOException("Resposta vazia do catálogo")
            Gson().fromJson<List<Channel>>(body, object : TypeToken<List<Channel>>() {}.type)
                ?: throw java.io.IOException("Catálogo inválido")
        }
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

    private fun fetchHomeConfig(client: OkHttpClient, url: String): HomeConfig? = try {
        val request = Request.Builder().url(url).header("Accept", "application/json").build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful || body.isNullOrBlank()) null else Gson().fromJson(body, HomeConfig::class.java)
        }
    } catch (e: Exception) {
        null
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
        binding.sidebar.visibility = View.VISIBLE
        binding.homeMenu.visibility = View.GONE
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
            // Quando os controles estão abertos, as setas e o OK pertencem
            // aos botões e à barra de progresso, inclusive tela cheia.
            if (binding.playerView.isShown && binding.playerView.isControllerFullyVisible &&
                event.keyCode != KeyEvent.KEYCODE_BACK) {
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
            if (isMoviePlaying() && event.keyCode in setOf(
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_NUMPAD_ENTER,
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                    KeyEvent.KEYCODE_MEDIA_PLAY,
                    KeyEvent.KEYCODE_MEDIA_PAUSE
                )
            ) {
                val shouldPlay = when (event.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY -> true
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> false
                    else -> !exoPlayer.isPlaying
                }
                exoPlayer.playWhenReady = shouldPlay
                binding.playerView.showController()
                Toast.makeText(this, if (shouldPlay) "Reproduzindo" else "Pausado", Toast.LENGTH_SHORT).show()
                return true
            }
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && seekMovie(-10_000)) {
                        binding.playerView.showController()
                        return true
                    }
                    if (binding.channelPanel.visibility != View.VISIBLE && changeMatchStream(-1)) {
                        return true
                    }
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    if (binding.channelPanel.visibility != View.VISIBLE && seekMovie(10_000)) {
                        binding.playerView.showController()
                        return true
                    }
                    if (binding.channelPanel.visibility != View.VISIBLE && changeMatchStream(1)) {
                        return true
                    }
                    return super.dispatchKeyEvent(event)
                }
                KeyEvent.KEYCODE_DPAD_UP -> {
                    // Fora do player, a seta pertence ao RecyclerView: ela só move
                    // o foco entre os cards. Troca automática de episódio é exclusiva
                    // da reprodução em tela cheia.
                    if (isPlayerVisible() && changeSeriesEpisode(-1)) return true
                }
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    if (isPlayerVisible() && changeSeriesEpisode(1)) return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun isPlayerVisible(): Boolean =
        binding.playerView.visibility == View.VISIBLE ||
            binding.iframeWebView.visibility == View.VISIBLE

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            binding.homeMenu.visibility == View.VISIBLE -> super.onBackPressed()
            binding.episodesGridPanel.visibility == View.VISIBLE -> {
    binding.episodesGridPanel.visibility = View.GONE
    openSeriesCatalog()
}
            binding.seriesGridPanel.visibility == View.VISIBLE -> showHomeMenu()
            binding.catalogGridPanel.visibility == View.VISIBLE && movieCategoryMenuOpen -> openMovieCatalog()
            binding.catalogGridPanel.visibility == View.VISIBLE && footballGroupMenuOpen -> openFootballCatalog()
            binding.catalogGridPanel.visibility == View.VISIBLE -> showHomeMenu()
            binding.playerView.visibility == View.VISIBLE && binding.playerView.isControllerFullyVisible -> {
                binding.playerView.hideController()
            }
            binding.playerView.visibility == View.VISIBLE || binding.iframeWebView.visibility == View.VISIBLE -> exitPlayerToCurrentMenu()
            binding.channelPanel.visibility == View.VISIBLE &&
    seriesEpisodeMenuOpen -> {
    binding.channelPanel.visibility = View.GONE
    openSeriesCatalog()
}
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

    private fun capturePlayerReturnScreen() {
        if (binding.playerView.isShown || binding.iframeWebView.isShown) return
        playerReturnScreen = when {
            binding.catalogGridPanel.isShown -> "catalog"
            binding.episodesGridPanel.isShown -> "episodes"
            binding.channelPanel.isShown -> "channels"
            else -> "home"
        }
        playerReturnWasChannels = playerReturnScreen == "channels"
        playerReturnWasHome = playerReturnScreen == "home"
        if (playerReturnScreen == "catalog") {
            playerReturnGridState = binding.catalogGrid.layoutManager?.onSaveInstanceState()
            val focused = binding.catalogGrid.findFocus()
            playerReturnGridPosition = focused?.let { binding.catalogGrid.findContainingViewHolder(it)?.bindingAdapterPosition }?.coerceAtLeast(0) ?: 0
        }
    }

    private fun playChannel(channel: Channel) {
        saveMovieProgress()
        if (channel.type.equals("series-group", ignoreCase = true)) {
            openSeriesEpisodes(channel.url, channel.series ?: channel.name, channel.poster)
            return
        }
        if (channel.type.equals("match-group", ignoreCase = true)) {
            capturePlayerReturnScreen()
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

        capturePlayerReturnScreen()
        activeMatchGroupId = null
        currentChannel = channel
        showPlayerTitle(channel)
        recordRecentlyWatched(channel)
        if (activeSeriesEpisodes.isNotEmpty()) {
            activeSeriesEpisodeIndex = activeSeriesEpisodes.indexOfFirst { it.url == channel.url }
            if (activeSeriesEpisodeIndex >= 0) saveLastWatchedSeriesEpisode(channel.url)
        }
        streamReloadAttempts = 0
        hlsLastPositionMs = C.TIME_UNSET
        hlsLastProgressAt = 0L
        hlsLastRecoveryAt = 0L
        hlsRecoveryAttempts = 0
        hlsStartedAt = SystemClock.elapsedRealtime()
        when (channel.type.lowercase()) {
            "hls" -> playStream(channel.url)
            "mp4" -> playMovieWithResumeChoice(channel)
            "kick" -> resolveAndPlayKick(channel.url)
            "embed" -> playEmbedInExternalBrowser(channel.url)
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
        showPlayerTitle(stream)
        streamReloadAttempts = 0
        playBrowserPage(stream.url)
        Toast.makeText(
            this,
            "${stream.name}  •  ${activeMatchStreamIndex + 1}/${streams.size}",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun resolveAndPlayKick(playbackEndpoint: String) {
        // Em celulares/tablets a página da Kick é mais compatível que o HLS
        // temporário retornado pela API, especialmente em Android WebView.
        val isTelevision = (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
            Configuration.UI_MODE_TYPE_TELEVISION
        if (!isTelevision) {
            val username = Regex("/channels/([^/]+)/playback-url", RegexOption.IGNORE_CASE)
                .find(playbackEndpoint)?.groupValues?.getOrNull(1)
            if (!username.isNullOrBlank()) {
                playBrowserPage("https://kick.com/${Uri.encode(username)}")
                return
            }
        }
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
            "hls" -> recoverFrozenHls(reason)
            "mp4" -> playStream(channel.url, movieResumePosition(channel))
            else -> {}
        }
    }

    private fun hlsPlaybackUrl(url: String): String {
        // As URLs HLS do catálogo já apontam para o proxy do servidor.
        // Não envolver novamente no proxy antigo do aplicativo.
        return url
    }

    private fun playStream(url: String, resumePositionMs: Long = 0L, showController: Boolean = true) {
        if (url.isBlank()) return
        enterPlayerMode()
        hideIFramePlayer()
        val isMp4 = Uri.parse(url).path.orEmpty().endsWith(".mp4", ignoreCase = true) ||
            currentChannel?.type.equals("mp4", ignoreCase = true)
        Log.i(
            if (isMp4) "TVBOX_PLAYER" else "TVBOX_HLS",
            "Iniciando ${if (isMp4) "MP4" else "HLS"} (host=${Uri.parse(url).host ?: "desconhecido"})"
        )
        val mediaItem = MediaItem.Builder()
            .setUri(hlsPlaybackUrl(url))
            .setMimeType(if (isMp4) MimeTypes.VIDEO_MP4 else MimeTypes.APPLICATION_M3U8)
            .build()
        if (isMp4) {
            exoPlayer.setMediaItem(mediaItem)
        } else {
            hlsMediaSourceFactory.createMediaSource(mediaItem).let(exoPlayer::setMediaSource)
        }
        if (resumePositionMs > 0) exoPlayer.seekTo(resumePositionMs)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        if (showController && !hlsRecovering) binding.playerView.showController()
        hlsRecovering = false
    }

    private fun showPlayerTitle(channel: Channel) {
        val episodeInfo = if (channel.season != null || channel.episode != null) {
            " • T${channel.season ?: 1} E${channel.episode ?: 1}"
        } else ""
        playerTitleOverlay.text = channel.name + episodeInfo
        playerTitleOverlay.visibility = View.VISIBLE
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

    private fun cardProgress(channel: Channel): Int {
        if (!channel.type.equals("mp4", true) || channel.url.isBlank()) return 0
        val p = getSharedPreferences("movie_progress", MODE_PRIVATE)
        val position = p.getLong("position_${channel.url.hashCode()}", 0L)
        val duration = p.getLong("duration_${channel.url.hashCode()}", 0L)
        return if (duration > 0 && position > 5_000L && position < duration - 10_000L)
            ((position.toDouble() / duration) * 1000).toInt() else 0
    }

    private fun playMovieWithResumeChoice(channel: Channel) {
        val resume = movieResumePosition(channel)
        if (resume <= 5_000L) {
            playStream(channel.url, 0L)
            return
        }
        AlertDialog.Builder(this)
            .setTitle(channel.name)
            .setMessage("Você parou em ${resume / 1000}s. Deseja continuar de onde parou?")
            .setPositiveButton("Continuar") { _, _ -> playStream(channel.url, resume) }
            .setNegativeButton("Começar do início") { _, _ -> playStream(channel.url, 0L) }
            .show()
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
            preferences.edit().remove(key).remove("duration_${movie.url.hashCode()}").apply()
        } else {
            preferences.edit().putLong(key, position)
                .putLong("duration_${movie.url.hashCode()}", duration.coerceAtLeast(0L)).apply()
        }
    }

    private fun playIFrame(url: String) {
        if (url.isBlank()) return
        enterPlayerMode()
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
        enterPlayerMode()
        exoPlayer.pause()
        binding.playerView.visibility = View.GONE
        binding.iframeWebView.visibility = View.VISIBLE
        binding.iframeWebView.loadUrl(url)
    }

    /**
     * Usa o Fennec instalado no TV Box para páginas embed. Ele possui um motor
     * de navegação atual e evita as limitações do Android System WebView 83.
     * Se o Fennec não existir, mantém o navegador interno como alternativa.
     */
    private fun playEmbedInExternalBrowser(url: String) {
        if (url.isBlank()) return
        exoPlayer.pause()
        try {
            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                setPackage("org.mozilla.fennec_fdroid")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(browserIntent)
            Toast.makeText(this, "Abrindo no Fennec", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Fennec não encontrado; abrindo no navegador interno", Toast.LENGTH_SHORT).show()
            playBrowserPage(url)
        }
    }

    private fun hideIFramePlayer() {
        binding.iframeWebView.stopLoading()
        binding.iframeWebView.loadUrl("about:blank")
        binding.iframeWebView.visibility = View.GONE
        binding.playerView.visibility = View.VISIBLE
    fullscreenButton.visibility = View.VISIBLE
    }

    /** Player ocupa a TV inteira; navegação e catálogo voltam somente no BACK. */
    private fun enterPlayerMode() {
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding.catalogGridPanel.visibility = View.GONE
        binding.homeMenu.visibility = View.GONE
        binding.channelPanel.visibility = View.GONE
        binding.seriesGridPanel.visibility = View.GONE
        binding.sidebar.visibility = View.GONE
        binding.episodesGridPanel.visibility = View.GONE
        binding.playerView.requestFocus()
    }

    /** Sai sem nova requisição e reaproveita exatamente a lista já aberta. */
   
private fun exitPlayerToCurrentMenu() {
    saveMovieProgress()
    exoPlayer.pause()
    window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    binding.iframeWebView.stopLoading()
    binding.iframeWebView.visibility = View.GONE
    binding.playerView.visibility = View.GONE
    playerTitleOverlay.visibility = View.GONE
    fullscreenButton.visibility = View.GONE

    if (playerReturnScreen == "catalog") {
        binding.homeMenu.visibility = View.GONE
        binding.sidebar.visibility = View.GONE
        binding.channelPanel.visibility = View.GONE
        binding.seriesGridPanel.visibility = View.GONE
        binding.episodesGridPanel.visibility = View.GONE
        binding.catalogGridPanel.visibility = View.VISIBLE
        binding.catalogGrid.layoutManager?.onRestoreInstanceState(playerReturnGridState)
        binding.catalogGrid.post {
            (binding.catalogGrid.findViewHolderForAdapterPosition(playerReturnGridPosition)?.itemView ?: binding.catalogGrid).requestFocus()
        }
    } else if (playerReturnScreen == "episodes" && activeSeriesEpisodes.isNotEmpty()) {
        binding.channelPanel.visibility = View.GONE
        binding.sidebar.visibility = View.GONE
        binding.seriesGridPanel.visibility = View.GONE
        binding.episodesGridPanel.visibility = View.VISIBLE

        binding.episodesGrid.scrollToPosition(
            activeSeriesEpisodeIndex.coerceAtLeast(0)
        )

        binding.episodesGrid.post {
            binding.episodesGrid
                .findViewHolderForAdapterPosition(
                    activeSeriesEpisodeIndex.coerceAtLeast(0)
                )
                ?.itemView
                ?.requestFocus()
        }
    } else if (playerReturnScreen == "channels") {
        showChannelMenu()
    } else {
        showHomeMenu()
    }
}


    override fun onStart() {
        super.onStart()
        binding.iframeWebView.resumeTimers()
        binding.iframeWebView.onResume()
    }

    override fun onStop() {
        // O Android pode manter a Activity em memória ao abrir outro app
        // (ex.: YouTube). Pare também o áudio, não apenas ao destruir a tela.
        exoPlayer.pause()
        exoPlayer.playWhenReady = false
        binding.iframeWebView.onPause()
        binding.iframeWebView.pauseTimers()
        saveMovieProgress()
        super.onStop()
        // Não manter o TVBox em segundo plano quando o usuário abre outro app.
        // O progresso já foi salvo acima; ao retornar, a Activity será criada
        // novamente sem deixar áudio ou WebView ativos.
        if (!isChangingConfigurations && !isFinishing) {
            finishAndRemoveTask()
        }
    }

    override fun onDestroy() {
        startupAnimator?.cancel()
        if (binding.root.viewTreeObserver.isAlive) binding.root.viewTreeObserver.removeOnGlobalFocusChangeListener(sidebarFocusListener)
        super.onDestroy()
        saveMovieProgress()
        mainHandler.removeCallbacks(playbackWatchdog)
        mainHandler.removeCallbacks(hlsFreezeMonitor)
        mainHandler.removeCallbacks(kickLiveRefresh)
        mainHandler.removeCallbacks(bannerRotation)
        binding.iframeWebView.destroy()
        exoPlayer.release()
        binding.recyclerView.adapter = null
    }
}
