package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import coil.load

data class EpgGuideItem(
    val channel: Channel,
    val currentProgram: String?,
    val currentTime: String?,
    val nextProgram: String?,
    val nextTime: String?
)

class EpgGuideAdapter(
    private val onChannelSelected: (Channel) -> Unit
) : RecyclerView.Adapter<EpgGuideAdapter.GuideViewHolder>() {

    private var items: List<EpgGuideItem> = emptyList()

    fun submitList(newItems: List<EpgGuideItem>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GuideViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_epg_guide_channel, parent, false)
        return GuideViewHolder(view)
    }

    override fun onBindViewHolder(holder: GuideViewHolder, position: Int) {
        val item = items[position]
        holder.channelName.text = item.channel.name
        holder.currentTime.text = item.currentTime?.let { "AGORA · $it" } ?: "PRÓXIMO"
        holder.currentProgram.text = item.currentProgram ?: "Sem programa no ar"
        holder.nextProgram.text = item.nextProgram?.let {
            "${item.nextTime ?: ""}  A SEGUIR · $it"
        } ?: "Sem próxima programação"
        holder.channelLogo.load(item.channel.poster) {
            crossfade(true)
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
        }
        holder.itemView.contentDescription = buildString {
            append(item.channel.name)
            item.currentProgram?.let { append(". Agora: $it") }
            item.nextProgram?.let { append(". A seguir: $it") }
        }
        holder.itemView.setOnClickListener { onChannelSelected(item.channel) }
    }

    override fun getItemCount(): Int = items.size

    class GuideViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val channelLogo: ImageView = itemView.findViewById(R.id.guide_channel_logo)
        val channelName: TextView = itemView.findViewById(R.id.guide_channel_name)
        val currentTime: TextView = itemView.findViewById(R.id.guide_current_time)
        val currentProgram: TextView = itemView.findViewById(R.id.guide_current_program)
        val nextProgram: TextView = itemView.findViewById(R.id.guide_next_program)
    }
}
