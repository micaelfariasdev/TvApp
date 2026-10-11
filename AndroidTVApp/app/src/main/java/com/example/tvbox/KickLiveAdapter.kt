package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import de.hdodenhof.circleimageview.CircleImageView
import kotlinx.android.synthetic.main.item_kick_live.view.*

data class KickLiveChannel(
    val name: String,
    val poster: String?,
    val kickName: String,
    var isLive: Boolean = false
)

class KickLiveAdapter(
    private val channels: List<KickLiveChannel>,
    private val onItemClick: (KickLiveChannel) -> Unit
) : RecyclerView.Adapter<KickLiveAdapter.KickLiveViewHolder>() {

    inner class KickLiveViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val channelPoster: CircleImageView = itemView.findViewById(R.id.channel_poster)
        val channelName: android.widget.TextView = itemView.findViewById(R.id.channel_name)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): KickLiveViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_kick_live, parent, false)
        return KickLiveViewHolder(view)
    }

    override fun onBindViewHolder(holder: KickLiveViewHolder, position: Int) {
        val channel = channels[position]
        holder.channelName.text = channel.name
        Glide.with(holder.itemView.context)
            .load(channel.poster)
            .placeholder(R.drawable.media_poster_placeholder)
            .error(R.drawable.media_poster_placeholder)
            .into(holder.channelPoster)
        holder.itemView.setOnClickListener { onItemClick(channel) }
    }

    override fun getItemCount(): Int = channels.size
}